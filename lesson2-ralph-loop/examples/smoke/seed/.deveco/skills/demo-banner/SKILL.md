---
name: demo-banner
description: 生成项目的 ASCII 横幅并写入 BANNER.txt。当目标要求制作横幅/banner 时使用。
---

# demo-banner

把项目做成一张三行的 ASCII 横幅,写入项目根目录的 `BANNER.txt`:

1. 第一行:`==== <项目目录名> ====`
2. 第二行:当前日期(用 bash `date +%F` 取,格式 YYYY-MM-DD)
3. 第三行:`powered by ralph loop`

写完用 bash `cat BANNER.txt` 验证三行齐全。
