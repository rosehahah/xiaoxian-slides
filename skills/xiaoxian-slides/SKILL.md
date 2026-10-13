---
name: xiaoxian-slides
description: 将文章、大纲或素材制作成小苋风格的离线 HTML 演示，保留翻页、快捷键、目录和讲者备注；也支持修改已有演示与导出 PDF、图片版 PPTX。适用于分享、授课、项目介绍和路演，不用于制作可编辑 PowerPoint 模板。
---

# 小苋演示

交付能直接用浏览器打开的 HTML 演示。用随 Skill 提供的构建器和播放器承载交互，集中处理内容与版式；不要每次重写翻页、快捷键、全屏或讲者窗口代码。

## 先定位文件

将本 `SKILL.md` 所在目录视为 Skill 根目录，脚本与资源都相对它定位。不要假定用户当前工作目录、安装位置或操作系统。输出放在用户指定目录；未指定时，在当前工作目录创建一个名称清楚的演示文件夹。需要 Node.js 20 或更新版本。HTML 构建无需 npm 依赖、账号或 API key。

开始制作前读 [设计规则](references/design-rules.md) 与 [数据格式](references/data-format.md)。修改已有演示时先找到它对应的 JSON 内容文件；保留用户已有内容和明确的风格选择。

## 制作流程

1. 从已有材料判断受众、目的、时长与必须保留的信息。缺少但不妨碍制作的条件，说明采用的假设后继续；缺少事实、数据或图片来源时标出缺口，不编造材料。
2. 把材料组织成演示，而非把文章逐段搬上屏幕。每页围绕一个观点，标题说出结论；根据内容关系选择版式。依据讲述节奏拆页，避免为了凑页数重复内容。
3. 按数据格式写 JSON。把详细展开、过渡和证据放进 `notes`：写清“开口怎么说、重点怎么展开、如何收束到下一页”。`seconds` 只作为建议时长，不能承诺实际演讲时长。
4. 执行构建器，生成 HTML。示例命令中的 `<skill-root>` 与 `<output-dir>` 要替换为实际绝对路径并正确引用：

   ```bash
   node "<skill-root>/scripts/build.mjs" "<output-dir>/slides.json" -o "<output-dir>/slides.html"
   ```

5. 在可用浏览器或截图工具中检查成品：封面、最长文本页、图片页、最后一页，以及其余有特殊布局的页面。检查文字溢出、图像裁切、对比度与留白；试翻页、目录、全屏、帮助和讲者窗口。可用自动化时检查全部页面。修复内容或版式后重新构建。
6. 同时交付 HTML 与 JSON，说明如何打开、有哪些已验证功能，以及真实限制。若当前环境不能运行或预览，应明确报告尚未验证的部分，不把仅写好 JSON 当作演示已完成。

## 修改与导出

修改演示优先改 JSON 并重新构建。播放器已有的交互应保持可用；若用户明确要求改交互，再修改运行时代码并验证。

只有用户需要 PDF 或 PPTX 时运行导出器。它需要可选依赖及 Playwright Chromium；先运行导出器 `--help` 并检查环境。完整仓库可在项目根目录运行 `npm install` 与 `npx playwright install chromium`。独立安装的 Skill 可用下列命令，`<skill-root>` 替换为实际路径：

```bash
npm install --prefix "<skill-root>" --no-save playwright@1.62.1 pptxgenjs@4.0.1
npm exec --prefix "<skill-root>" -- playwright install chromium
```

安装依赖与浏览器需要联网。然后执行：

```bash
node "<skill-root>/scripts/export.mjs" "<output-dir>/slides.html" --out-dir "<output-dir>/exports"
```

导出 PDF 与图片版 PPTX 是静态页面。PPTX 每页是一张图片，文字不能在 PowerPoint 中单独编辑；HTML 的动画、快捷键与目录交互仅在浏览器内保留。可写入 PPTX 讲者备注。不要承诺可编辑 PPTX 或等价转场效果。

HTML 可独立离线播放，构建器会内嵌本地图像。用户图片与内容可能有独立授权，交付或公开之前按用户要求处理；不要把私人素材自动放入公开示例。
