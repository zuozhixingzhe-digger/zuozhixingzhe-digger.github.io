#!/usr/bin/env python3
"""生成汉字编解码应用的数据常量。

产物：build/66b-hanzi-data.js
  HZ_TABLE_RAW      4096 字（GB2312 区位序，前 4096）
  HZ_TABLE_2048     2048 字（同表前 2048）
  HZ_PINYIN_GROUPS  "音节:同音字…|音节:同音字…"（CJK 基本区，首读音）
  HZ_MARKS_A/B/C    三套互不重叠的标记字（都不在 4096 表内）
"""
import re, pathlib, json
from pypinyin import pinyin, Style
from pypinyin.pinyin_dict import pinyin_dict


def gb2312_chars():
    out = []
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode('gb2312')
            except Exception:
                continue
            if len(ch) == 1 and '\u4e00' <= ch <= '\u9fff':
                out.append(ch)
    return out


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    html = pathlib.Path('/root/uploads/1794139109917486981-hex-hanzi-codec.html').read_text(encoding='utf-8')
    m = re.search(r'const CODE_TABLE_RAW\s*=\s*"([^"]+)"', html)
    assert m, 'CODE_TABLE_RAW 没找到'
    table = m.group(1)
    assert len(table) == 4096 and len(set(table)) == 4096, (len(table), len(set(table)))

    gb = gb2312_chars()
    # 校验：附件码表确实来自 GB2312 前 4096 字
    same = sum(1 for a, b in zip(table, gb[:4096]) if a == b)
    print('gb2312 chars:', len(gb), 'table==gb2312[:4096]:', table == ''.join(gb[:4096]), 'match', same)

    # ---- 读音分组（CJK 基本区，取首读音，轻声补 5）
    groups = {}
    for cp in range(0x4E00, 0xA000):
        ch = chr(cp)
        if cp not in pinyin_dict:
            continue
        try:
            py = pinyin(ch, style=Style.TONE3, heteronym=False, errors='ignore')
        except Exception:
            continue
        if not py or not py[0]:
            continue
        s = py[0][0]
        if not s or not s[-1].isdigit():
            s += '5'          # 轻声
        if not re.fullmatch(r'[a-z]+[1-5]', s):
            continue
        groups.setdefault(s, []).append(ch)

    print('syllables:', len(groups), 'chars:', sum(len(v) for v in groups.values()))
    assert len(groups) < 2048, len(groups)

    # 标记字：从 GB2312 后段挑，排除 4096 表；三套互斥
    used = set(table) | set('圮圯坜')
    pool = [c for c in gb[4096:5200] if c not in used][::17]
    seen, marks = set(), []
    for c in pool:
        if c in seen:
            continue
        seen.add(c)
        marks.append(c)
        if len(marks) >= 27:
            break
    print('marks:', ''.join(marks), len(marks))
    A = ['圮', '圯', '坜']
    B = marks[:11]
    C = marks[11:27]

    for name, arr in (('A', A), ('B', B), ('C', C)):
        assert len(set(arr)) == len(arr) and not (set(arr) & set(table)), name
    assert not (set(A) & set(B)) and not (set(A) & set(C)) and not (set(B) & set(C))

    # 音节按字典序固定，索引才可复现
    ordered = sorted(groups.items())
    packed = '|'.join(k + ':' + ''.join(v) for k, v in ordered)

    out = root / 'build' / '66b-hanzi-data.js'
    js = f"""/* 自动生成，不要手改：tools/gen-hanzi-data.py
 * 码表 4096 字来自 GB2312 区位序（可离线复现）；读音分组来自 pypinyin 字典，
 * 只取每个字的首读音，轻声补 5。标记字三套互斥且都不在 4096 表内。 */
const HZ_TABLE_RAW = {json.dumps(table, ensure_ascii=False)};
const HZ_TABLE_2048 = HZ_TABLE_RAW.slice(0, 2048);
const HZ_MARKS_A = {json.dumps(''.join(A), ensure_ascii=False)}.split('');
const HZ_MARKS_B = {json.dumps(''.join(B), ensure_ascii=False)}.split('');
const HZ_MARKS_C = {json.dumps(''.join(C), ensure_ascii=False)}.split('');
const HZ_PINYIN_GROUPS = {json.dumps(packed, ensure_ascii=False)};
"""
    out.write_text(js, encoding='utf-8')
    print('wrote', out, out.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
