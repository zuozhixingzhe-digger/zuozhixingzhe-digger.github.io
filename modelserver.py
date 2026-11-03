#!/usr/bin/env python3
# hterminal modelserver — 无状态 Chat Completions 转发（Python / 标准库）
# SPDX-License-Identifier: Apache-2.0 OR MIT
# 由 AI 智能体生成并维护。
#
# 它只做四件事：监听 127.0.0.1、校验请求确实来自本机浏览器、把前端发来的
# Chat Completions 请求翻译成上游格式、把上游响应翻译回 Chat Completions。
# 不保存对话、不读文件、不执行工具、不写日志文件。密钥只在环境变量里。
#
# 环境变量：
#   HT_PORT=8787                 监听端口
#   OPENAI_API_KEY=...           OpenAI / 兼容服务密钥
#   OPENAI_BASE_URL=...          默认 https://api.openai.com/v1
#   ANTHROPIC_API_KEY=...        Anthropic 密钥
#   ANTHROPIC_BASE_URL=...       默认 https://api.anthropic.com/v1
#   HT_MODEL=gpt-4o-mini         请求未带 model 时的兜底
#   HT_TIMEOUT=120               上游超时秒数
#   HT_DEFAULT_PROVIDER=openai   openai | anthropic | responses | custom
#   HT_RPM=60                    模型请求每分钟上限（0 = 关闭限流）
#   HT_BURST=20                  允许的瞬时突发次数
#   HT_FETCH_RPM=120             抓网页每分钟上限（0 = 关闭）
#
# 命令行（优先级高于环境变量）：
#   --rpm 60  --burst 20  --fetch-rpm 120
#   --no-chat                    关闭模型请求
#   --no-fetch                   关闭网页抓取
#   --help
# 两个功能不能同时关闭：全关就没有可提供的服务，启动即退出（endpoint 也不监听）。

import argparse
import hashlib
import http.client
import ipaddress
import json
import math
import os
import re
import socket
import ssl
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"


def env_int(name, default):
    """环境变量读整数。写错了就用默认值——启动时因为一个拼错的 HT_RPM 崩掉
    不值当，但也不能悄悄变成 0（那等于关掉限流）。"""
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return int(default)


PORT = env_int("HT_PORT", 8787)
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
ANTHROPIC_VERSION = os.environ.get("ANTHROPIC_VERSION", "2023-06-01")
DEFAULT_MODEL = os.environ.get("HT_MODEL", "gpt-4o-mini")
DEFAULT_PROVIDER = os.environ.get("HT_DEFAULT_PROVIDER", "openai").lower()
TIMEOUT = float(os.environ.get("HT_TIMEOUT", "120"))
MAX_BODY = 8 * 1024 * 1024
RPM = env_int("HT_RPM", 60)
BURST = env_int("HT_BURST", 20)
FETCH_RPM = env_int("HT_FETCH_RPM", 120)
VERSION = "0.0.1.18"
# 功能注册表。将来加接口只在这里加一行，全关判定和路由白名单会自动跟着变。
# (argparse 里的开关名, 路由, 中文名)
FEATURES = (
    ("no_chat", "/v1/chat/completions", "模型请求"),
    ("no_fetch", "/v1/fetch", "网页抓取"),
)
# 关闭的接口与「根本不存在的路径」回同一个东西：状态码、头、正文逐字节一致。
# 绝不能回「该功能已关闭」——那等于告诉对方这里本来有个接口，只是被关了。
REJECTED = {"error": {"message": "请求不被接受", "type": "forbidden"}}
# 脚本所在目录：index.html 会从这里读
ROOT = os.path.dirname(os.path.abspath(__file__))


def text_of(content):
    """OpenAI content 可能是字符串，也可能是 [{type:text,text:...}]。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("text", "input_text", "output_text"):
                out.append(str(part.get("text", "")))
            elif isinstance(part, str):
                out.append(part)
        return "\n".join(out)
    if content is None:
        return ""
    return str(content)


def join_url(base, path):
    base = base.rstrip("/")
    if base.endswith(path):
        return base
    return base + path


def upstream(url, payload, headers):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except Exception as e:
        return 502, {"error": {"message": "连不上上游：%s" % e, "type": "upstream_unreachable"}}
    try:
        return status, json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return 502, {"error": {"message": "上游返回了非 JSON（HTTP %s）" % status, "type": "bad_upstream"}}


# ------------------------------------------------------------------ 抓网页（/v1/fetch）
#
# 为什么需要它：浏览器里的 fetch 受同源策略管，新闻站（163/百度/知乎）一律不带
# CORS 头，直连必失败；r.jina.ai / allorigins 这类公共代理在国内经常连不上。
# 于是「让智能体抓 10 条新闻」在真实网络里几乎必然失败——工具摆着却不能用。
# 本机后端不受同源策略约束，由它代抓是最稳的一条路。
#
# 安全：不做「任意代理」。只允许 http/https、只允许 80/443、目标必须解析到公网 IP
# （逐跳校验，重定向也算新的一跳），挡掉拿来打内网/本机端口的 SSRF；响应上限 3 MB。
FETCH_MAX = 3 * 1024 * 1024
FETCH_TIMEOUT = float(os.environ.get("HT_FETCH_TIMEOUT", "20"))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """自己处理重定向：每一跳都要重新查一次「是不是公网地址」。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# 下面两个连接类只做一件事：**连我们已经校验过的那颗 IP**，而不是把域名交给
# 系统再解析一次。这就是挡 DNS rebinding 的关键——
#
#   校验(host) → 1.2.3.4（公网，放行）
#   连接(host) → 第二次解析 → 127.0.0.1（进内网）
#
# 中间那几毫秒里，攻击者只要让 DNS 换个答案，前面所有校验都白做。
# 所以 DNS 只查一次，查完把 IP 钉死；Host 头和 TLS SNI 仍然用域名，
# 虚拟主机与证书校验都不受影响。
def _peer_is_public(sock):
    """问 socket「你实际连上的是谁」，而不是问 DNS「它说它是谁」。

    这是整套 SSRF 校验里唯一不可伪造的一步：前面的解析结果可能被缓存、被代理
    改写、被后来的一次解析覆盖，但 getpeername() 返回的是内核里那条已建立的
    连接的对端地址，说不了谎。校验的对象从「计划」变成「事实」。
    """
    try:
        peer = sock.getpeername()
    except OSError:
        return False
    try:
        addr = str(peer[0]).split("%")[0]   # 去掉 IPv6 的 scope id
        return ipaddress.ip_address(addr).is_global
    except Exception:
        return False


def _connect_verified(ip, port, timeout, source_address=None):
    """建连后立刻验证对端。不通过就把连接关掉——绝不把 socket 交出去。"""
    sock = socket.create_connection((ip, port), timeout, source_address)
    if not _peer_is_public(sock):
        try:
            sock.close()
        except Exception:
            pass
        raise ValueError("对端不是公网地址（连接后被拒）")
    return sock


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        # 两道：钉住 IP（不留第二次解析的机会）+ 连上后核对对端（不信任何预测）
        self.sock = _connect_verified(self._ip, self.port, self.timeout,
                                      self.source_address)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        # TCP 连上先验对端，再握手：证书再合法，也不能掩盖「连错了机器」
        sock = _connect_verified(self._ip, self.port, self.timeout,
                                 self.source_address)
        try:
            # server_hostname 用域名：SNI 和证书域名校验都按原样来
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            try:
                sock.close()
            except Exception:
                pass
            raise


def _resolve_public(host):
    """解析一次，把「全部是公网」的 IP 列表返回给调用方钉住用。

    任一 A/AAAA 记录落在私网就整体拒绝——多记录轮询是绕 IP 校验的常见手法。
    """
    host = (host or "").strip().lower().strip("[]")
    if not host or host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("目标不是公网地址：%s" % (host or "?"))
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except Exception:
        raise ValueError("域名解析失败：%s" % host)
    ips = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except Exception:
            raise ValueError("域名解析失败：%s" % host)
        if not ip.is_global:
            raise ValueError("目标不是公网地址：%s" % host)
        s = str(ip)
        if s not in ips:
            ips.append(s)
    if not ips:
        raise ValueError("域名解析失败：%s" % host)
    return ips


def _charset_of(headers, raw):
    ctype = headers.get("Content-Type", "") or ""
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    if m:
        return m.group(1)
    m = re.search(br'charset=["\']?([\w-]+)', raw[:4096], re.I)
    if m:
        return m.group(1).decode("ascii", "ignore")
    return "utf-8"


def _fetch_once(url, ip):
    """对钉死的 IP 发一次 GET，不跟随重定向。返回 (status, headers, body)。"""
    parts = urllib.parse.urlsplit(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    cls = _PinnedHTTPSConnection if parts.scheme == "https" else _PinnedHTTPConnection
    conn = cls(parts.hostname, ip, port, FETCH_TIMEOUT)
    try:
        conn.request("GET", path, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            "Connection": "close",
        })
        resp = conn.getresponse()
        raw = resp.read(FETCH_MAX + 1)
        return resp.status, resp.headers, raw
    finally:
        conn.close()


def fetch_public(url):
    url = str(url or "").strip()
    if not url:
        raise ValueError("url 为空")
    seen = []
    prev_scheme = None
    for _ in range(5):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https"):
            raise ValueError("只支持 http/https")
        # 重定向只能平级或升级，不能降级：https → http 等于把接下来的
        # 全部内容交给明文链路，攻击者只要能控制一次跳转就能做到。
        if prev_scheme == "https" and parts.scheme == "http":
            raise ValueError("拒绝从 HTTPS 降级到 HTTP 的重定向")
        prev_scheme = parts.scheme
        if parts.username or parts.password:
            raise ValueError("URL 不能带账号密码")
        if not parts.hostname:
            raise ValueError("URL 缺少主机名")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in (80, 443):
            raise ValueError("只允许 80/443 端口")
        ips = _resolve_public(parts.hostname)
        status = headers = raw = None
        last = None
        # 多 A 记录时按解析顺序试，最多 3 个。全部来自上面那一次解析，
        # 任何一个都校验过，换 IP 重试不会把校验绕过去。
        for ip in ips[:3]:
            try:
                status, headers, raw = _fetch_once(url, ip)
                break
            except Exception as e:
                last = e
        if status is None:
            raise ValueError("抓取失败：%s" % last)
        if status in (301, 302, 303, 307, 308):
            loc = headers.get("Location")
            if not loc:
                raise ValueError("HTTP %s 但没给 Location" % status)
            url = urllib.parse.urljoin(url, loc)
            seen.append(url)
            if len(seen) > 4:
                raise ValueError("重定向太多")
            continue
        if len(raw) > FETCH_MAX:
            raw = raw[:FETCH_MAX]
        cs = _charset_of(headers, raw)
        try:
            text = raw.decode(cs, "replace")
        except LookupError:
            text = raw.decode("utf-8", "replace")
        return {
            "status": status,
            "finalUrl": url,
            "contentType": headers.get("Content-Type", "") or "",
            "text": text,
            "redirects": seen,
        }
    raise ValueError("重定向太多")


# ---------------------------------------------------------------- 自我沙箱
#
# 目的：把「后端的权限」从「跑它的那个用户的全部权限」缩到「只能发 HTTP 请求」。
# 就算这个进程被完全控制（某个 0day、某个依赖、或者我们自己写错的代码），
# 它也读不到 ~/.ssh/id_rsa、.env、浏览器数据，写不了 ~/.bashrc 和启动项。
# 这层不替代前面的校验：前面的校验决定「谁能进来」，这层决定「进来后能碰什么」。
#
# Linux：Landlock（内核 5.13+，且 LSM 列表里要有 landlock）。
#   模型是「默认拒绝已声明的权限」：我们声明文件读/写/建/删全管，然后只给
#   系统库、CA 证书、DNS 配置开只读口子，写入只留 /dev/null。
#   网络权限不声明 = 不受限，出网照常（这正是它的工作）。
#   不需要 root、不需要改系统配置，普通用户跑起来就是受限的。
# macOS：seatbelt（sandbox_init）。策略是「禁写、允许读」——macOS 上把读也
#   关死会连 Python 自己的 stdlib 和 CA 证书一起关掉，收益远小于风险。
# Windows：没有等价的、无需管理员的按进程文件 ACL 接口（AppContainer 要建
#   配置文件与 ACL），这里明确不做，只打印一行提示。
#
# 全部失败都不致命：环境不支持就退化成「无沙箱」，并在启动横幅里写清楚。
# --unsafe-no-self-restrict 直接跳过（裸机/容器/兼容性问题时的逃生门）。

ctypes = None  # 延迟导入：只在真的要下沙箱时才付这个代价

LL_EXECUTE = 1 << 0
LL_WRITE_FILE = 1 << 1
LL_READ_FILE = 1 << 2
LL_READ_DIR = 1 << 3
LL_REMOVE_DIR = 1 << 4
LL_REMOVE_FILE = 1 << 5
LL_MAKE_CHAR = 1 << 6
LL_MAKE_DIR = 1 << 7
LL_MAKE_REG = 1 << 8
LL_MAKE_SOCK = 1 << 9
LL_MAKE_FIFO = 1 << 10
LL_MAKE_BLOCK = 1 << 11
LL_MAKE_SYM = 1 << 12
LL_REFER = 1 << 13      # ABI 2
LL_TRUNCATE = 1 << 14   # ABI 3

LL_READ = LL_READ_FILE | LL_READ_DIR | LL_EXECUTE
SYS_LANDLOCK_CREATE_RULESET = 444
SYS_LANDLOCK_ADD_RULE = 445
SYS_LANDLOCK_RESTRICT_SELF = 446
PR_SET_NO_NEW_PRIVS = 38


def _libc():
    global ctypes
    if ctypes is None:
        import ctypes as _c
        ctypes = _c
        libc = ctypes.CDLL(None, use_errno=True)
        libc.syscall.restype = ctypes.c_long
        return libc
    return ctypes.CDLL(None, use_errno=True)


class _RulesetAttr(object):
    """struct landlock_ruleset_attr：两个 u64。ABI<4 时不认第二个字段，size 要变小。"""

    def __init__(self, fs=0, net=0):
        import ctypes as _c
        self._buf = _c.create_string_buffer(16)
        _c.c_uint64.from_buffer(self._buf, 0).value = fs
        _c.c_uint64.from_buffer(self._buf, 8).value = net
        self.ptr = _c.cast(self._buf, _c.c_void_p)


class _PathBeneath(object):
    """struct landlock_path_beneath_attr：u64 + s32，packed → 12 字节。"""

    def __init__(self, access, fd):
        import ctypes as _c
        self._buf = _c.create_string_buffer(12)
        _c.c_uint64.from_buffer(self._buf, 0).value = access
        _c.c_int32.from_buffer(self._buf, 8).value = fd
        self.ptr = _c.cast(self._buf, _c.c_void_p)


def _close_quiet(fd):
    try:
        os.close(fd)
    except OSError:
        pass


def _landlock_abi():
    libc = _libc()
    n = libc.syscall(SYS_LANDLOCK_CREATE_RULESET, None, 0, 1)
    return int(n) if n > 0 else 0


def _sandbox_rules():
    """白名单：只给「跑起来真会用到」的东西开口子。

    读：python 自己的 stdlib / 扩展模块、动态库、CA 证书、DNS 与 hosts 配置、
        时区、随机源。
    写：只有 /dev/null。
    其它一律没有——包括 /tmp（真需要临时文件的功能就不该在服务端做）。
    """
    roots = ["/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/opt",
             sys.prefix, sys.base_prefix,
             "/etc/ssl", "/etc/pki", "/etc/ca-certificates", "/etc/crypto-policies",
             "/proc/self", "/sys/devices/system/cpu"]
    files = ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/gai.conf",
             "/etc/localtime", "/etc/ld.so.cache", "/dev/urandom", "/dev/random",
             "/dev/zero"]
    rules = [(p, LL_READ) for p in roots]
    rules += [(p, LL_READ_FILE) for p in files]
    rules.append(("/dev/null", LL_READ_FILE | LL_WRITE_FILE))
    return rules


def _apply_landlock():
    abi = _landlock_abi()
    if abi <= 0:
        return False, "内核未启用 Landlock（需要 5.13+，且 lsm 里有 landlock）"
    libc = _libc()
    handled = ((1 << 13) - 1)          # ABI 1 的 13 项文件权限
    if abi >= 2:
        handled |= LL_REFER
    if abi >= 3:
        handled |= LL_TRUNCATE
    attr = _RulesetAttr(handled, 0)
    size = 16 if abi >= 4 else 8       # 老内核不认 handled_access_net
    fd = libc.syscall(SYS_LANDLOCK_CREATE_RULESET, attr.ptr, size, 0)
    if fd < 0:
        return False, "创建规则集失败（errno %d）" % ctypes.get_errno()
    added = 0
    for path, rights in _sandbox_rules():
        try:
            pfd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        except OSError:
            continue                    # 这台机器上没有这个路径，跳过
        try:
            rule = _PathBeneath(rights & handled, pfd)
            if libc.syscall(SYS_LANDLOCK_ADD_RULE, fd, 1, rule.ptr, 0) == 0:
                added += 1
        finally:
            os.close(pfd)
    # no_new_privs：没有它 restrict_self 会被拒（非 root 时）
    libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
    if libc.syscall(SYS_LANDLOCK_RESTRICT_SELF, fd, 0) != 0:
        e = ctypes.get_errno()
        _close_quiet(fd)
        return False, "restrict_self 失败（errno %d）" % e
    _close_quiet(fd)
    return True, "landlock abi=%d · 只读白名单 %d 项 · 可写仅 /dev/null" % (abi, added)


_SEATBELT_PROFILE = """(version 1)
(allow default)
(deny file-write*)
(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr")
                   (subpath "/dev/fd") (subpath "/private/var/folders"))
"""


def _apply_seatbelt():
    libc = _libc()
    try:
        sandbox_init = libc.sandbox_init
    except AttributeError:
        return False, "系统里没有 sandbox_init（新版 macOS 可能已移除）"
    err = ctypes.c_char_p()
    rc = sandbox_init(_SEATBELT_PROFILE.encode(), ctypes.c_uint64(0), ctypes.byref(err))
    if rc != 0:
        msg = (err.value or b"").decode("utf-8", "replace")
        return False, "seatbelt 拒绝加载策略：%s" % msg
    return True, "seatbelt · 禁止写文件（读不限）"


def apply_sandbox(enabled=True):
    """给当前进程套上平台沙箱。返回 (是否成功, 说明)。"""
    if not enabled:
        return False, "已跳过（--unsafe-no-self-restrict）"
    try:
        if sys.platform.startswith("linux"):
            return _apply_landlock()
        if sys.platform == "darwin":
            return _apply_seatbelt()
        if sys.platform.startswith("win"):
            return False, "Windows 没有无需管理员的按进程文件 ACL 接口，未启用"
        return False, "未知平台 %s，未启用" % sys.platform
    except Exception as e:
        return False, "启用失败：%s" % e


def sandbox_selftest():
    """套上之后立刻验一遍：该拒的确实拒了，而不是「我以为拒了」。"""
    out = []
    try:
        with open("/etc/passwd", "rb") as f:
            f.read(1)
        out.append(("读 /etc/passwd", "仍可读"))
    except OSError:
        out.append(("读 /etc/passwd", "已拒"))
    probe = "/tmp/.ht-sandbox-probe-%d" % os.getpid()
    try:
        with open(probe, "wb") as f:
            f.write(b"x")
        try:
            os.unlink(probe)
        except OSError:
            pass
        out.append(("写 /tmp", "仍可写"))
    except OSError:
        out.append(("写 /tmp", "已拒"))
    return out


# ------------------------------------------------------------------ OpenAI / custom
def _reject_const(name):
    """RFC 8259 不认 NaN / Infinity / -Infinity。

    Python 的 json 默认接受，会原样透传给上游，然后上游返回一个莫名其妙的 4xx，
    看起来像「模型服务坏了」。在入口就当非法 JSON 拒掉（自测 C14）。
    """
    raise ValueError("不支持的 JSON 常量：%s" % name)


def do_openai(body, base, key):
    url = join_url(base, "/chat/completions")
    payload = dict(body)
    payload.pop("provider", None)
    if not payload.get("model"):
        payload["model"] = DEFAULT_MODEL
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    return upstream(url, payload, headers)


# ------------------------------------------------------------------ Anthropic
def to_anthropic(body):
    system = []
    msgs = []
    for m in body.get("messages", []):
        role = m.get("role")
        content = m.get("content")
        if role == "system":
            system.append(text_of(content))
        elif role == "user":
            msgs.append({"role": "user", "content": text_of(content)})
        elif role == "assistant":
            blocks = []
            if text_of(content):
                blocks.append({"type": "text", "text": text_of(content)})
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                blocks.append({"type": "tool_use", "id": tc.get("id") or "call_%d" % int(time.time() * 1000),
                               "name": fn.get("name", ""), "input": args})
            if not blocks:
                blocks = [{"type": "text", "text": ""}]
            msgs.append({"role": "assistant", "content": blocks})
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": m.get("tool_call_id") or "",
                     "content": text_of(content)}
            last = msgs[-1] if msgs else None
            if last and last.get("role") == "user" and last.pop("_toolbatch", False):
                last["content"].append(block)
                last["_toolbatch"] = True
            else:
                msgs.append({"role": "user", "content": [block], "_toolbatch": True})
    for m in msgs:
        m.pop("_toolbatch", None)

    payload = {
        "model": body.get("model") or DEFAULT_MODEL,
        "max_tokens": int(body.get("max_tokens") or body.get("max_completion_tokens") or 4096),
        "messages": msgs,
    }
    if system:
        payload["system"] = "\n\n".join(system)
    if body.get("temperature") is not None:
        payload["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        payload["top_p"] = body["top_p"]
    if body.get("stop") is not None:
        payload["stop_sequences"] = body["stop"] if isinstance(body["stop"], list) else [body["stop"]]

    tools = []
    for t in body.get("tools", []) or []:
        if t.get("type") != "function":
            continue
        fn = t.get("function") or {}
        tools.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    if tools:
        payload["tools"] = tools
        tc = body.get("tool_choice")
        if tc == "auto":
            payload["tool_choice"] = {"type": "auto"}
        elif tc == "required":
            payload["tool_choice"] = {"type": "any"}
        elif isinstance(tc, dict) and tc.get("type") == "function":
            payload["tool_choice"] = {"type": "tool", "name": (tc.get("function") or {}).get("name", "")}
    return payload


def from_anthropic(data, model):
    text = []
    calls = []
    for b in data.get("content", []) or []:
        if b.get("type") == "text":
            text.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            calls.append({
                "id": b.get("id") or "call_%d" % int(time.time() * 1000),
                "type": "function",
                "function": {"name": b.get("name", ""),
                             "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)},
            })
    msg = {"role": "assistant", "content": "".join(text)}
    if calls:
        msg["tool_calls"] = calls
    reason = {"end_turn": "stop", "tool_use": "tool_calls", "max_tokens": "length",
              "stop_sequence": "stop"}.get(data.get("stop_reason"), "stop")
    u = data.get("usage") or {}
    return {
        "id": data.get("id") or "chatcmpl-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": data.get("model") or model,
        "choices": [{"index": 0, "message": msg, "finish_reason": reason}],
        "usage": {
            "prompt_tokens": u.get("input_tokens", 0),
            "completion_tokens": u.get("output_tokens", 0),
            "total_tokens": u.get("input_tokens", 0) + u.get("output_tokens", 0),
        },
    }


def do_anthropic(body):
    payload = to_anthropic(body)
    headers = {"Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION}
    if ANTHROPIC_KEY:
        headers["x-api-key"] = ANTHROPIC_KEY
    status, data = upstream(join_url(ANTHROPIC_BASE, "/messages"), payload, headers)
    if status >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        msg = err.get("message") if isinstance(err, dict) else json.dumps(data, ensure_ascii=False)[:400]
        return status, {"error": {"message": msg or "上游错误", "type": "upstream_error", "provider": "anthropic"}}
    return 200, from_anthropic(data, payload["model"])


# ------------------------------------------------------------------ OpenAI Responses
def to_responses(body):
    instructions = []
    items = []
    for m in body.get("messages", []):
        role = m.get("role")
        content = text_of(m.get("content"))
        if role == "system":
            instructions.append(content)
        elif role == "user":
            items.append({"role": "user", "content": [{"type": "input_text", "text": content}]})
        elif role == "assistant":
            if content:
                items.append({"role": "assistant", "content": [{"type": "output_text", "text": content}]})
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                items.append({"type": "function_call", "call_id": tc.get("id") or "",
                              "name": fn.get("name", ""), "arguments": fn.get("arguments") or "{}"})
        elif role == "tool":
            items.append({"type": "function_call_output", "call_id": m.get("tool_call_id") or "",
                          "output": content})

    payload = {
        "model": body.get("model") or DEFAULT_MODEL,
        "input": items,
    }
    if instructions:
        payload["instructions"] = "\n\n".join(instructions)
    if body.get("max_tokens") or body.get("max_output_tokens"):
        payload["max_output_tokens"] = int(body.get("max_tokens") or body.get("max_output_tokens"))
    if body.get("temperature") is not None:
        payload["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        payload["top_p"] = body["top_p"]

    tools = []
    for t in body.get("tools", []) or []:
        if t.get("type") != "function":
            continue
        fn = t.get("function") or {}
        tools.append({"type": "function", "name": fn.get("name", ""),
                      "description": fn.get("description", ""),
                      "parameters": fn.get("parameters") or {"type": "object", "properties": {}}})
    if tools:
        payload["tools"] = tools
        tc = body.get("tool_choice")
        if isinstance(tc, str):
            payload["tool_choice"] = tc
        elif isinstance(tc, dict) and tc.get("type") == "function":
            payload["tool_choice"] = {"type": "function", "name": (tc.get("function") or {}).get("name", "")}
    return payload


def from_responses(data, model):
    text = []
    calls = []
    for item in data.get("output", []) or []:
        if item.get("type") == "message":
            for c in item.get("content", []) or []:
                if c.get("type") == "output_text":
                    text.append(c.get("text", ""))
        elif item.get("type") == "function_call":
            calls.append({
                "id": item.get("call_id") or item.get("id") or "call_%d" % int(time.time() * 1000),
                "type": "function",
                "function": {"name": item.get("name", ""),
                             "arguments": item.get("arguments") or "{}"},
            })
    msg = {"role": "assistant", "content": "".join(text)}
    if calls:
        msg["tool_calls"] = calls
    finish = "tool_calls" if calls else ("length" if data.get("status") == "incomplete" else "stop")
    u = data.get("usage") or {}
    return {
        "id": data.get("id") or "chatcmpl-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": data.get("model") or model,
        "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
        "usage": {
            "prompt_tokens": u.get("input_tokens", 0),
            "completion_tokens": u.get("output_tokens", 0),
            "total_tokens": u.get("total_tokens", u.get("input_tokens", 0) + u.get("output_tokens", 0)),
        },
    }


def do_responses(body):
    payload = to_responses(body)
    headers = {"Content-Type": "application/json"}
    if OPENAI_KEY:
        headers["Authorization"] = "Bearer " + OPENAI_KEY
    status, data = upstream(join_url(OPENAI_BASE, "/responses"), payload, headers)
    if status >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        msg = err.get("message") if isinstance(err, dict) else json.dumps(data, ensure_ascii=False)[:400]
        return status, {"error": {"message": msg or "上游错误", "type": "upstream_error", "provider": "responses"}}
    return 200, from_responses(data, payload["model"])


# ------------------------------------------------------------------ HTTP
# 安全边界（三条，缺一不可）：
#   1. socket 层只绑 127.0.0.1，外面进不来
#   2. Host 头必须是本机名，挡 DNS rebinding（evil.com 解析到 127.0.0.1 也没用）
#   3. Origin / Sec-Fetch-Site 必须是「本机页面」，挡任意公网网页借浏览器打本地端口
ALLOWED_HOSTS = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT, "[::1]:%d" % PORT}
LOCAL_NAMES = ("127.0.0.1", "localhost", "::1")


def origin_allowed(origin):
    """Origin 只认本机页面。

    - 缺省（同源导航、curl、服务端调用）：允许
    - "null"：**拒绝**。sandbox iframe / data: 页面的 Origin 就是 null，
      不拒的话任何网站都能用 `<iframe sandbox srcdoc="fetch('http://127.0.0.1:8787')">`
      绕过同源策略打本地服务。
    - 其它：必须是 http(s) 且 host 是本机名。端口不卡死（本地开发常换端口），
      但公网域名一律不认。
    """
    if not origin:
        return True
    if origin.strip().lower() == "null":
        return False
    try:
        from urllib.parse import urlparse
        u = urlparse(origin)
        if u.scheme not in ("http", "https"):
            return False
        return (u.hostname or "").lower() in LOCAL_NAMES
    except Exception:
        return False


class TokenBucket:
    """令牌桶限流。进程级单例，按路由分桶（模型 / 抓网页各一个）。

    为什么不用「每分钟最多 N 次」的固定窗口：窗口边界会放过两倍突发——
    59 秒打满 N 次、下一秒再打满 N 次，两秒内就是 2N 次；而中间大段空闲
    又不会攒下任何补偿。令牌桶按时间连续补，持续速率被限住，同时留一个
    受控的瞬时突发。

    burst 不是「给攻击者的余量」，是给正常用法的：智能体一轮任务会连着调
    好几次模型（模型 → 工具 → 模型 → 工具），一次提问 3~8 个请求很正常。
    桶太小，正常对话第一轮就撞 429；桶太大，页面脚本 for 循环能刷满。

    失败不扣令牌：被拒的请求不该让下一次等更久。
    """

    __slots__ = ("rpm", "rate", "burst", "tokens", "last", "lock", "rejected")

    def __init__(self, rpm, burst):
        self.rpm = max(1, int(rpm))
        self.rate = self.rpm / 60.0
        self.burst = float(max(1, int(burst)))
        self.tokens = self.burst
        self.last = time.monotonic()
        self.lock = threading.Lock()
        self.rejected = 0

    def take(self):
        """取一个令牌。返回 0 = 放行；否则是建议等待的秒数。"""
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
            self.last = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return 0.0
            self.rejected += 1
            return (1.0 - self.tokens) / self.rate


class Server(ThreadingHTTPServer):
    """带并发上限的本地服务。

    ThreadingHTTPServer 是「来一个连接起一个线程」，既没有上限也没有超时。
    自测实测：100 个连上不说话的连接 = 100 个常驻线程，一直不释放（slowloris）；
    默认 request_queue_size 只有 5，20 并发就触发 SYN 重传（1 秒起延迟），
    200 并发开始出现超时。这里补三样：

      - request_queue_size = 128    排队能力，不再是 5
      - BoundedSemaphore(128)       第 129 个并发直接 503，不再无限起线程
      - Handler.timeout = 15        慢速头 / 慢速体最多占 15 秒
    """
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128
    # 128 而不是 64：一次浏览器对同源最多开 6 条连接，128 已经远超正常用量；
    # 而 64 太少——自测里 100 个半开连接就能把槽位占满，让正常请求吃 503。
    max_workers = 128

    def __init__(self, *a, chat_bucket=None, fetch_bucket=None, routes=None, index=None,
                 index_mtime=0, **kw):
        super().__init__(*a, **kw)
        self._slots = threading.BoundedSemaphore(self.max_workers)
        self.saturated = 0
        # None = 该通道关闭限流（--rpm 0）
        self.chat_bucket = chat_bucket
        self.fetch_bucket = fetch_bucket
        # 启用的路由白名单。不在里面的路径——无论是被 --no-* 关掉的，
        # 还是压根不存在——都走同一个 403，探不出区别。
        # frozenset 不可变：运行期没有任何代码能往里加一条路由。
        self.routes = frozenset(routes or ())
        # 静态页在启动时读一次，之后只发内存里这一份（见 load_index）。
        self.index_raw = index
        self.index_mtime = index_mtime
        self.index_etag = ('"' + hashlib.sha256(index).hexdigest()[:20] + '"'
                           if index else None)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self.saturated += 1
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\n"
                                b"Retry-After: 1\r\nContent-Length: 0\r\n"
                                b"Connection: close\r\n\r\n")
            except Exception:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hterminal-modelserver"
    # 不报 Python 版本：`Server: hterminal-modelserver/0.0.1.15 Python/3.11.1`
    # 等于把「该打哪个 CVE」直接写在响应头里（0.0.1.16 修）。
    sys_version = ""
    # 连接级超时。BaseHTTPRequestHandler 在建连后调用 settimeout，
    # 慢速头 / 慢速体最多占 15 秒；正常请求在等上游时没有 socket 读写，不受影响。
    timeout = 15

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), (fmt % args)))

    def version_string(self):
        # 默认是 server_version + " " + sys_version，sys_version 清空后会留一个尾空格
        return self.server_version

    def security_headers(self):
        """每个响应都带。X-Frame-Options / frame-ancestors 是重点：
        不让任何页面把本服务套进 iframe（点击劫持 + 借道读响应）。"""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        # 沙箱里自带录音机 / 定位，这两个能力必须对本页面开放（self），
        # 但绝不对第三方 iframe 开放：`()` 会让页内 getUserMedia 直接抛
        # "Permissions policy violation"，工具做好了也用不了（0.0.1.15 修）。
        self.send_header("Permissions-Policy", "geolocation=(self), microphone=(self), camera=(self)")

    def cors(self):
        """只对「已经通过 Origin 校验」的请求回 CORS 头，绝不回显任意 Origin，
        也绝不发 Allow-Credentials。"""
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-HTerm-Provider, X-HTerm-Client")
        self.send_header("Access-Control-Max-Age", "600")

    def reply(self, status, obj, extra=None):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.security_headers()
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        # 错误响应一律关连接。原因：429/403/415 都发生在读 body 之前，
        # 请求体还躺在 socket 里；keep-alive 复用这条连接时，下一轮会把那段
        # JSON 当成请求行来解析 → "Bad request syntax" → 一个莫名其妙的 400。
        # 关掉连接，未读的字节跟着 socket 一起消失。
        if status >= 400:
            self.close_connection = True
            self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            # 客户端先断了（关页面、超时取消）。这不是错误，但默认会把
            # 一整段 traceback 打到 stderr，把真正的异常淹掉。
            pass

    def _deny(self, reason, detail):
        sys.stderr.write("[%s] deny %s: %s\n" % (time.strftime("%H:%M:%S"), reason, detail))
        self.reply(403, {"error": {"message": detail, "type": "forbidden"}})
        return False

    def rate_gate(self, bucket, label):
        """超限回 429。放在鉴权之后、读 body 之前：
        未授权的请求不该白占额度，被拒的请求也不该让我们去读 8 MB 请求体。"""
        if bucket is None:
            return True
        wait = bucket.take()
        if wait <= 0:
            return True
        retry = max(1, int(math.ceil(wait)))
        # 被脚本狂刷时，每次一行能把 stderr 变成日志炸弹。只报第一次和每 50 次。
        if bucket.rejected == 1 or bucket.rejected % 50 == 0:
            sys.stderr.write("[%s] 429 %s（累计拒绝 %d 次，%d 次/分）\n"
                             % (time.strftime("%H:%M:%S"), label, bucket.rejected, bucket.rpm))
        self.reply(429, {
            "error": {
                "message": "%s过于频繁（上限 %d 次/分），请 %d 秒后再试" % (label, bucket.rpm, retry),
                "type": "rate_limit_error",
                "code": "rate_limited",
            }
        }, {
            "Retry-After": str(retry),
            "X-RateLimit-Limit": str(bucket.rpm),
            "X-RateLimit-Remaining": "0",
        })
        return False

    def local_only(self):
        """四重校验：socket 层 / Host / Origin / Sec-Fetch-Site。"""
        peer = self.client_address[0]
        if peer not in ("127.0.0.1", "::1"):
            return self._deny("peer", "仅允许本机访问")
        host = self.headers.get("Host", "")
        if host not in ALLOWED_HOSTS:
            return self._deny("host", "Host 不被允许（只接受 127.0.0.1 / localhost）")
        origin = self.headers.get("Origin")
        if not origin_allowed(origin):
            return self._deny("origin", "Origin 不被允许（%s）" % origin)
        # Sec-Fetch-Site 是浏览器自己打的标，页面改不了：
        # cross-site 一律拒绝，等于把「公网网页 → 本地端口」这条路彻底堵死。
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if site == "cross-site":
            return self._deny("fetch-site", "跨站请求被拒绝")
        return True

    def do_OPTIONS(self):
        if not self.local_only():
            return
        if not self.headers.get("Origin"):
            self.reply(403, {"error": {"message": "预检必须带 Origin", "type": "forbidden"}})
            return
        self.send_response(204)
        self.cors()
        self.security_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_index(self):
        """发启动时读进内存的那一份。

        为什么不在每个请求里 open()：路径上的东西可以被换掉（软链、重命名、
        bind mount），"先看路径再打开" 天然有两步。启动时用 O_NOFOLLOW 打开、
        fstat 确认是普通文件、一次读完，之后只发这个 bytes 对象——请求阶段的
        磁盘状态与响应内容彻底解耦，改文件不会影响已启动的实例（重启才生效）。
        """
        raw = self.server.index_raw
        etag = self.server.index_etag
        if raw is None:
            self.reply(404, {"error": {"message": "找不到 index.html（把它和本脚本放在同一目录）", "type": "not_found"}})
            return
        # index.html 是把全部代码内联进去的单文件，七百多 KB。
        # 以前发 no-store，每刷新一次就重下整包；改成协商缓存——
        # 内容没变走 304（只回一个头），改了才重发。no-cache 不是「不缓存」，
        # 是「每次用之前问我一句」，正好适合这种一改就要立刻生效的单页。
        inm = self.headers.get("If-None-Match", "")
        if inm and etag in [x.strip() for x in inm.split(",")]:
            self.send_response(304)
            self.security_headers()
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        self.send_response(200)
        self.security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        # 用快照时的 mtime，不是现在的（文件可能已经被改过，但发出去的不是它）
        self.send_header("Last-Modified", self.date_time_string(int(self.server.index_mtime)))
        self.end_headers()
        self.wfile.write(raw)

    def deny(self):
        # 只放行页面、健康检查、已启用的接口。其余一律拒绝——不做文件服务器，
        # 免得本机任何一个网页都能借这个端口读你的磁盘。
        # 文案里不出现任何路径或能力名：那等于给探测者送情报。
        self.reply(403, REJECTED)

    def do_GET(self):
        if not self.local_only():
            return
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self.serve_index()
            return
        if path == "/health":
            # 只报「活着」。以前这里列 providers 明细，等于一份能力清单：
            # 关了哪个功能、有没有配 key，一问便知。前端只用 r.ok，不影响。
            self.reply(200, {
                "ok": True,
                "service": "hterminal-modelserver",
                "version": VERSION,
            })
            return
        self.deny()

    def do_POST(self):
        if not self.local_only():
            return
        route = self.path.split("?")[0]
        # 白名单在 Server 上，跟着 --no-chat / --no-fetch 变。被关掉的接口
        # 和瞎猜的路径走同一条分支，响应完全一样（0.0.1.17）。
        if route not in self.server.routes:
            self.reply(403, REJECTED)
            return
        # 大小写不敏感：客户端 0.0.1.2 起产品名统一成 HTerMinaL，头值也改成了
        # "HTerMinaL"，而这里一直拿小写全等比较 —— 结果是自家前端每次都被自己
        # 403（0.0.1.15 修）。这个头的意义只是「必须触发 CORS 预检 + 自证是自家
        # 页面」，不是在验口令，没必要卡大小写。
        # 重复头必须拒：有的服务器取第一个、有的取最后一个、有的拼成 "a, b"。
        # 「哪个值说了算」取决于实现，正是头走私的土壤（自测 C15）。
        clients = self.headers.get_all("X-HTerm-Client") or []
        if len(clients) != 1 or clients[0].strip().lower() != "hterminal":
            self.reply(403, {"error": {"message": "缺少、重复或错误的 X-HTerm-Client", "type": "forbidden"}})
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            # 只收 application/json：挡住 text/plain、form-urlencoded 这类
            # 「不触发预检就能发出去」的简单请求。
            self.reply(415, {"error": {"message": "Content-Type 必须是 application/json", "type": "unsupported_media_type"}})
            return
        # 限流在鉴权之后、读 body 之前。两条通道分开算：抓网页是廉价代理，
        # 模型请求要花钱；用同一个桶，抓 100 条新闻就会把对话额度吃光。
        is_fetch = route == "/v1/fetch"
        if not self.rate_gate(self.server.fetch_bucket if is_fetch else self.server.chat_bucket,
                              "抓网页请求" if is_fetch else "模型请求"):
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.reply(400, {"error": {"message": "请求体为空或过大", "type": "bad_request"}})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8", "replace"),
                              parse_constant=_reject_const)
        except Exception as e:
            self.reply(400, {"error": {"message": "JSON 解析失败：%s" % e, "type": "bad_request"}})
            return
        # 合法 JSON 不等于合法请求体。`[]`、`"x"`、`null`、数字都能通过 json.loads，
        # 但紧接着的 body.get() 会抛 AttributeError —— 连接被直接掐断、客户端收到空响应、
        # stderr 打一整段 traceback（自测 C2/C3/C4 复现）。先统一成 400。
        if not isinstance(body, dict):
            self.reply(400, {"error": {"message": "请求体必须是 JSON 对象", "type": "bad_request"}})
            return
        if route == "/v1/fetch":
            try:
                data = fetch_public(body.get("url"))
                self.reply(200, data)
            except Exception as e:
                self.reply(502, {"error": {"message": "抓取失败：%s" % e, "type": "fetch_failed"}})
            return
        if body.get("stream"):
            self.reply(400, {"error": {"message": "本后端只支持非流式（stream:false）", "type": "bad_request"}})
            return

        raw_provider = self.headers.get("X-HTerm-Provider") or body.get("provider") or DEFAULT_PROVIDER
        # provider 来自请求体，可能是数字 / 数组。直接 .lower() 会崩（自测 C6/C7）。
        if not isinstance(raw_provider, str):
            self.reply(400, {"error": {"message": "provider 必须是字符串", "type": "bad_request"}})
            return
        provider = raw_provider.strip().lower()
        started = time.time()
        try:
            if provider in ("openai", "custom"):
                status, data = do_openai(body, OPENAI_BASE, OPENAI_KEY)
            elif provider == "anthropic":
                status, data = do_anthropic(body)
            elif provider in ("responses", "response"):
                status, data = do_responses(body)
            else:
                status, data = 400, {"error": {"message": "未知 provider：%s" % provider, "type": "bad_request"}}
        except Exception as e:
            status, data = 500, {"error": {"message": "服务器内部错误：%s" % e, "type": "internal"}}
        self.reply(status, data)
        sys.stderr.write("[%s] POST /v1/chat/completions provider=%s status=%s %.0fms\n"
                         % (time.strftime("%H:%M:%S"), provider, status, (time.time() - started) * 1000))


def load_index():
    """启动时把 index.html 读成一份不可变快照。

    这里用「先打开、再验 fd」而不是「先 stat 路径、再 open 路径」：后者是两步，
    中间那个名字可以被换成软链或别的文件；前者只做一次，验的对象就是即将要读的
    那个句柄（O_NOFOLLOW 顺带拒掉软链）。
    """
    path = os.path.join(ROOT, "index.html")
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None, 0
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            return None
        parts = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            parts.append(chunk)
        return b"".join(parts), st.st_mtime
    finally:
        os.close(fd)


def main():
    ap = argparse.ArgumentParser(
        prog="modelserver.py",
        description="HTerMinaL modelserver：本地 Chat Completions 转发（默认 127.0.0.1:%d）" % PORT)
    ap.add_argument("--rpm", type=int, default=RPM, metavar="N",
                    help="模型请求每分钟上限，0 关闭限流（默认 %(default)s）")
    ap.add_argument("--burst", type=int, default=BURST, metavar="N",
                    help="允许的瞬时突发次数（默认 %(default)s）")
    ap.add_argument("--fetch-rpm", type=int, default=FETCH_RPM, metavar="N", dest="fetch_rpm",
                    help="抓网页每分钟上限，0 关闭（默认 %(default)s）")
    ap.add_argument("--no-chat", action="store_true", help="关闭模型请求（/v1/chat/completions）")
    ap.add_argument("--no-fetch", action="store_true", help="关闭网页抓取（/v1/fetch）")
    ap.add_argument("--unsafe-no-self-restrict", action="store_true",
                    dest="no_sandbox",
                    default=os.environ.get("HT_NO_SELF_RESTRICT", "").lower() in ("1", "true", "yes"),
                    help="跳过平台自沙箱（Landlock/seatbelt）。只在兼容性出问题时用")
    args = ap.parse_args()

    # 功能注册表决定路由白名单。将来加功能只改 FEATURES，这里不用动。
    enabled = {path for flag, path, _ in FEATURES if not getattr(args, flag, False)}
    if not enabled:
        # 全关 = 没有可提供的服务。与其监听一个什么都不干的端口，
        # 不如直接退出——一个只回 403 的端口本身就是情报。
        ap.error("所有功能都被关闭了（%s），没有可提供的服务，拒绝启动"
                 % "、".join(name for _, _, name in FEATURES))

    burst = max(1, args.burst)
    chat_bucket = TokenBucket(args.rpm, burst) if args.rpm > 0 else None
    fetch_bucket = TokenBucket(args.fetch_rpm, burst) if args.fetch_rpm > 0 else None

    # 只在启动时读一次。之后请求阶段不碰磁盘。
    index, index_mtime = load_index()

    srv = Server((HOST, PORT), Handler, chat_bucket=chat_bucket, fetch_bucket=fetch_bucket,
                 routes=enabled, index=index, index_mtime=index_mtime)
    print("hterminal modelserver %s" % VERSION)
    print("  listening  http://%s:%d" % (HOST, PORT))
    print("  features   %s" % " · ".join(sorted(enabled)))
    print("  index.html %s" % ("%d B（启动时快照）" % len(index) if index else "缺失（/ 会 404）"))
    print("  limits     并发 %d · 排队 %d · 连接超时 %ds"
          % (srv.max_workers, srv.request_queue_size, Handler.timeout))
    def rate_text(path, bucket, rpm):
        if path not in enabled:
            return "closed"
        return "off" if bucket is None else "%d/min burst %d" % (rpm, burst)

    print("  rate       chat %s · fetch %s"
          % (rate_text("/v1/chat/completions", chat_bucket, args.rpm),
             rate_text("/v1/fetch", fetch_bucket, args.fetch_rpm)))
    ok, why = apply_sandbox(not args.no_sandbox)
    print("  sandbox    %s%s" % ("ON  " if ok else "off ", why))
    if ok:
        for what, res in sandbox_selftest():
            print("             %s：%s" % (what, res))
    print("  providers  openai=%s anthropic=%s responses=%s" % (
        "yes" if OPENAI_KEY else "no", "yes" if ANTHROPIC_KEY else "no", "yes" if OPENAI_KEY else "no"))
    print("  密钥只在环境变量；不保存对话；不执行工具；不写文件。")
    print("  Ctrl-C 停止。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", file=sys.stderr)
        srv.server_close()


if __name__ == "__main__":
    main()
