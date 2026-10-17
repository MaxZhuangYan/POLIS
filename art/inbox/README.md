# art/inbox — 美术素材收件箱

把生成好的原始图片（PNG）放在这里，一张一个文件，文件名按约定（如 `portrait-mira.png`、`building-hall.png`）。
`manifest.md` 记录每张图的尺寸、是否透明、生成时用的完整提示词。

这里只放**原始图**，游戏不会直接读取。处理（缩放到游戏尺寸、对齐像素网格、统一调色板）之后的图放进
`public/assets/`，由处理脚本生成。
