// markdown 子集解析:## / ### 标题、- 列表、> 引用、**加粗**、普通段落。
// 输出结构直接供 wxml 循环渲染(不引入 towxml)。
export interface MdSpan { text: string; bold: boolean }
export interface MdNode { type: 'h2' | 'h3' | 'li' | 'quote' | 'p'; spans: MdSpan[] }

function parseSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans.length ? spans : [{ text, bold: false }];
}

export function parseMarkdown(md: string): MdNode[] {
  const nodes: MdNode[] = [];
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) nodes.push({ type: 'h3', spans: parseSpans(line.slice(4)) });
    else if (line.startsWith('## ')) nodes.push({ type: 'h2', spans: parseSpans(line.slice(3)) });
    else if (line.startsWith('- ')) nodes.push({ type: 'li', spans: parseSpans(line.slice(2)) });
    else if (line.startsWith('> ')) nodes.push({ type: 'quote', spans: parseSpans(line.slice(2)) });
    else nodes.push({ type: 'p', spans: parseSpans(line.replace(/^#+\s*/, '')) });
  }
  return nodes;
}
