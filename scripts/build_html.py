#!/usr/bin/env python3
"""Bundle a static prototype or attach PageReview to an existing HTML file."""

import argparse
import base64
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


COMPONENTS = Path(__file__).resolve().parents[1] / "assets" / "components"
CSS_URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)""", re.I)
CLOSING_SCRIPT = re.compile(r"</script", re.I)


class Tags(HTMLParser):
    """Locate tags in the original text so unrelated markup stays intact."""

    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.line_offsets = [0, *(match.end() for match in re.finditer("\n", source))]
        self.start = []
        self.end = []
        self.feed(source)
        self.close()

    def source_offset(self):
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        offset = self.source_offset()
        self.start.append((tag, dict(attrs), offset, offset + len(raw)))

    def handle_endtag(self, tag):
        self.end.append((tag, self.source_offset()))


def apply_edits(source, edits):
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    return source


def local_path(base, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or parsed.path.startswith("/") or not parsed.path:
        raise ValueError(f"离线构建需要相对路径或内联素材：{url}")
    return base / unquote(parsed.path)


def data_url(base, url):
    if url.startswith(("data:", "#")):
        return url
    path = local_path(base, url)
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    fragment = urlsplit(url).fragment
    return f"data:{mime};base64,{encoded}" + (f"#{fragment}" if fragment else "")


def inline_css(source, base):
    if re.search(r"@import\s", source, re.I):
        raise ValueError("请先展开 CSS @import 再进行离线构建。")
    if re.search(r"</style", source, re.I):
        raise ValueError("CSS 包含无法直接内联的 style 结束标记。")
    return CSS_URL.sub(
        lambda match: 'url("' + data_url(base, next(part for part in match.groups() if part is not None)) + '")',
        source,
    )


def script(source, attrs=""):
    return f"<script{attrs}>\n" + CLOSING_SCRIPT.sub(lambda m: r"<\/" + m[0][2:], source) + "\n</script>"


def attribute_text(attrs):
    return "".join(
        f" {key}" if value is None else f' {key}="{html.escape(value, quote=True)}"'
        for key, value in attrs.items()
    )


def bundle(source, base):
    tags = Tags(source)
    edits = []
    for tag, attrs, start, end in tags.start:
        if tag == "script" and "src" in attrs:
            if set(attrs) & {"async", "defer", "integrity", "nomodule"} or attrs.get("type", "") not in {
                "", "text/javascript", "application/javascript"
            }:
                raise ValueError("请先用项目构建器打包模块或异步脚本。")
            path = local_path(base, attrs.pop("src"))
            closing = re.match(r"\s*</script\s*>", source[end:], re.I)
            if not closing:
                raise ValueError(f"外部脚本需要独立的结束标签：{path}")
            edits.append((start, end + closing.end(), script(path.read_text(encoding="utf-8"), attribute_text(attrs))))
        elif tag == "link" and "stylesheet" in (attrs.get("rel") or "").lower().split():
            path = local_path(base, attrs["href"])
            css = inline_css(path.read_text(encoding="utf-8"), path.parent)
            style_attrs = {key: value for key, value in attrs.items() if key in {"media", "id", "title"}}
            edits.append((start, end, f"<style{attribute_text(style_attrs)}>\n{css}\n</style>"))
        elif tag == "style":
            closing = next((offset for name, offset in tags.end if name == "style" and offset >= end), None)
            if closing is not None:
                edits.append((end, closing, inline_css(source[end:closing], base)))
        elif tag == "img" and attrs.get("src"):
            if "srcset" in attrs:
                raise ValueError("请为离线图片提供一个 src，或由项目构建器内联 srcset。")
            attrs["src"] = data_url(base, attrs["src"])
            edits.append((start, end, "<img" + attribute_text(attrs) + ">"))
    return apply_edits(source, edits)


def attach_review(source, project):
    if "PageReview." in source or "window.PageReview" in source:
        raise ValueError("HTML 已有 PageReview。请沿用现有评审入口和评审 ID。")
    tags = Tags(source)
    if any(tag == "meta" and (attrs.get("http-equiv") or "").lower() == "content-security-policy"
           for tag, attrs, _, _ in tags.start):
        raise ValueError("HTML 有内容安全策略，请按原项目的脚本加载方式接入组件。")
    body_end = next((offset for tag, offset in tags.end if tag == "body"), None)
    html_end = next((offset for tag, offset in tags.end if tag == "html"), len(source))
    insert_at = html_end if body_end is None else body_end
    project_json = json.dumps(project, ensure_ascii=False).replace("<", r"\u003c")
    bootstrap = """
document.addEventListener('DOMContentLoaded', () => {
  const contextFor = (element, fallbackId, fallbackTitle) => ({
    id: element.dataset.reviewTarget || fallbackId,
    title: element.dataset.reviewTitle || fallbackTitle,
    section: document.title || 'HTML 评审'
  });
  const review = PageReview.attachDrawer({
    project: PROJECT_JSON,
    context: contextFor(document.body, 'document', document.title || '当前页面')
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-review-target]:not(body)');
    if (target) review.setContext(contextFor(target, 'document', target.textContent.trim() || document.title));
  }, true);
});
""".replace("PROJECT_JSON", project_json)
    css = (COMPONENTS / "page-review.css").read_text(encoding="utf-8")
    js = (COMPONENTS / "page-review.js").read_text(encoding="utf-8")
    addition = "\n<style>\n" + css + "\n</style>\n" + script(js) + "\n" + script(bootstrap) + "\n"
    return source[:insert_at] + addition + source[insert_at:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--attach-review", metavar="PROJECT", help="添加评审，保留原有的资源引用")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("输入和输出应使用不同的文件。")
    try:
        source = args.source.read_text(encoding="utf-8")
        if args.attach_review is not None:
            project = args.attach_review.strip()
            if not project:
                raise ValueError("评审项目 ID 不能为空。")
            result = attach_review(source, project)
        else:
            result = bundle(source, args.source.parent)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result, encoding="utf-8")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
