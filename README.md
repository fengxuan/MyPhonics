# 见字即读

给学生用的自然拼读网站。看见字母，先读出它的本音，再把音素拼成单词。

线上地址：[https://myphonics.pages.dev/](https://myphonics.pages.dev/)

## 怎么学

按这个顺序练：

1. **认本音**：一个音一张卡片，听音标、口型和例词。
2. **拼读工坊**：从左到右拆开字母，再合成整个单词。
3. **闪电反应**：字母先出现，自己先读，停一拍再听标准音。
4. **过关测验**：听音选字母、看词选意思。80 分过关。

学习进度保存在本机浏览器里，换浏览器或清除网站数据后会重新开始。

## 十一课

| 课 | 内容 |
| --- | --- |
| 1 | s a t p i n |
| 2 | m d g o c k，c 在 a、o、u 前读 /k/ |
| 3 | 短元音 e、u，以及 r h b f l |
| 4 | j v w x y z qu |
| 5 | sh ch th ck ng，th 有轻音和浊音 |
| 6 | 辅音连读，中间不加「呃」 |
| 7 | 魔法 e |
| 8 | ai/ay、ee/ea、oa/ow、igh |
| 9 | oo 的两个音，ow/ou、oi/oy |
| 10 | ar、or、er/ir/ur |
| 11 | c、g、y 会看后面的字母变音 |

规律手册把这些规则收在一起，可以单独点开听例子。

## 发音

音标和「听本音」用的是英式国际音标，录音来自[新东方国际音标表](https://www.xdf.cn/zhuanti/bd-phonetic-alphabet-card/index.html)。

例句单词是美式录音，来自 Wikimedia Commons。所以短元音 o，以及带 r 的词，本音和整词听起来会有一点差别。

## 本地打开

在项目目录运行：

```bash
python3 -m http.server 8734
```

浏览器打开 [http://127.0.0.1:8734/](http://127.0.0.1:8734/)。

请用本地服务器打开。直接双击 `index.html` 时，部分浏览器会拦住音频。

## 重新部署

已登录 Cloudflare 后，在项目目录执行：

```bash
mkdir -p /tmp/myphonics-pages
rsync -a --exclude '.DS_Store' index.html css js audio /tmp/myphonics-pages/
wrangler pages deploy /tmp/myphonics-pages --project-name myphonics --branch main
```

## 目录

```
index.html     页面入口
css/app.css    样式
js/data.js     课程、单词和音标
js/app.js      页面和练习逻辑
audio/sounds   音素录音
audio/words    例句单词录音
```
