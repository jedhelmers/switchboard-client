// SwitchBoard mrkdwn parser — TypeScript reference implementation.
// Mirrors server/internal/mrkdwn/ in the switchboard-server repo, and
// passes the same MRKDWN_FIXTURES.json oracle. See MRKDWN.md for the
// dialect spec.
export function parse(input) {
    const normalized = input.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].trim() === '') {
            i++;
            continue;
        }
        if (lines[i].startsWith('```')) {
            const { node, next } = parseFencedCode(lines, i);
            blocks.push(node);
            i = next;
            continue;
        }
        if (isBlockquoteLine(lines[i])) {
            const { node, next } = parseBlockquote(lines, i);
            blocks.push(node);
            i = next;
            continue;
        }
        if (listMarker(lines[i]) !== '') {
            const { node, next } = parseList(lines, i);
            blocks.push(node);
            i = next;
            continue;
        }
        const { node, next } = parseParagraph(lines, i);
        blocks.push(node);
        i = next;
    }
    return blocks;
}
export function plainText(input) {
    return parse(input).map(blockToPlain).join('\n');
}
function parseFencedCode(lines, start) {
    const lang = lines[start].slice(3).trim();
    const body = [];
    let i = start + 1;
    while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
    }
    if (i < lines.length)
        i++; // consume closing fence
    return { node: { type: 'code_block', lang, value: body.join('\n') }, next: i };
}
function isBlockquoteLine(line) {
    return line === '>' || line.startsWith('> ');
}
function parseBlockquote(lines, start) {
    const innerLines = [];
    let i = start;
    while (i < lines.length && isBlockquoteLine(lines[i])) {
        if (lines[i] === '>')
            innerLines.push('');
        else
            innerLines.push(lines[i].slice(2));
        i++;
    }
    const inner = innerLines.join('\n');
    return { node: { type: 'blockquote', children: parse(inner) }, next: i };
}
// listMarker returns '-' for unordered, the literal leading digits for
// ordered (e.g. "1", "42"), or '' if the line is not a list line.
function listMarker(line) {
    if (line.startsWith('- '))
        return '-';
    let j = 0;
    while (j < line.length && line[j] >= '0' && line[j] <= '9')
        j++;
    if (j > 0 && j + 1 < line.length && line[j] === '.' && line[j + 1] === ' ') {
        return line.slice(0, j);
    }
    return '';
}
function parseList(lines, start) {
    const firstMarker = listMarker(lines[start]);
    const ordered = firstMarker !== '-';
    const items = [];
    let i = start;
    while (i < lines.length) {
        const marker = listMarker(lines[i]);
        if (marker === '')
            break;
        if ((marker === '-') === ordered)
            break; // marker kind switched
        const itemText = ordered
            ? lines[i].slice(marker.length + 2)
            : lines[i].slice(2);
        items.push([{ type: 'paragraph', children: parseInline(itemText) }]);
        i++;
    }
    return { node: { type: 'list', ordered, items }, next: i };
}
function parseParagraph(lines, start) {
    const pLines = [];
    let i = start;
    while (i < lines.length) {
        if (lines[i].trim() === '')
            break;
        if (startsBlock(lines[i]))
            break;
        pLines.push(lines[i]);
        i++;
    }
    const text = pLines.join('\n');
    return { node: { type: 'paragraph', children: parseInline(text) }, next: i };
}
function startsBlock(line) {
    if (line.startsWith('```'))
        return true;
    if (isBlockquoteLine(line))
        return true;
    if (listMarker(line) !== '')
        return true;
    return false;
}
// -------- inline parser --------
const MARKERS = new Set(['*', '_', '~']);
function parseInline(text) {
    const out = [];
    let buf = '';
    const flush = () => {
        if (buf.length > 0) {
            out.push({ type: 'text', value: buf });
            buf = '';
        }
    };
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        // inline code — escape hatch
        if (ch === '`') {
            const end = findCodeClose(text, i + 1);
            if (end > 0) {
                flush();
                out.push({ type: 'code_inline', value: text.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }
        // angle-bracket link <url> or <url|label>
        if (ch === '<' && atWordBoundary(text, i)) {
            const end = findLinkClose(text, i + 1);
            if (end > 0) {
                const inner = text.slice(i + 1, end);
                if (!/[<\n]/.test(inner)) {
                    const { url, label } = splitLink(inner);
                    flush();
                    out.push({
                        type: 'link',
                        url,
                        children: [{ type: 'text', value: label }],
                    });
                    i = end + 1;
                    continue;
                }
            }
        }
        // bare http(s) URL autolink
        if ((ch === 'h' || ch === 'H') && atWordBoundary(text, i)) {
            const match = matchBareURL(text, i);
            if (match) {
                flush();
                out.push({
                    type: 'link',
                    url: match.url,
                    children: [{ type: 'text', value: match.url }],
                });
                i += match.advance;
                continue;
            }
        }
        // emphasis
        if (MARKERS.has(ch) && canOpenEmphasis(text, i)) {
            const end = findEmphasisClose(text, i + 1, ch);
            if (end > 0) {
                flush();
                const inner = text.slice(i + 1, end);
                out.push({
                    type: 'emphasis',
                    style: emphasisStyle(ch),
                    children: parseInline(inner),
                });
                i = end + 1;
                continue;
            }
        }
        buf += ch;
        i++;
    }
    flush();
    return out;
}
function emphasisStyle(ch) {
    if (ch === '*')
        return 'bold';
    if (ch === '_')
        return 'italic';
    return 'strike';
}
function atWordBoundary(text, i) {
    if (i === 0)
        return true;
    const prev = text[i - 1];
    return isSpaceChar(prev) || isPunct(prev);
}
function isSpaceChar(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
function isPunct(ch) {
    return '.,;:!?()[]{}\'"/\\@#$%^&+=<>|'.includes(ch);
}
function canOpenEmphasis(text, i) {
    if (!atWordBoundary(text, i))
        return false;
    if (i + 1 >= text.length)
        return false;
    const next = text[i + 1];
    if (isSpaceChar(next))
        return false;
    if (next === text[i])
        return false; // rule 9: repeated marker
    if (i > 0 && text[i - 1] === text[i])
        return false; // rule 9, left side
    return true;
}
function findEmphasisClose(text, start, marker) {
    for (let j = start; j < text.length; j++) {
        const ch = text[j];
        if (ch === '\n')
            return 0;
        if (ch !== marker)
            continue;
        // rule 9: repeated marker on either neighbour (but not the opener)
        if (j > start && text[j - 1] === marker)
            continue;
        if (j + 1 < text.length && text[j + 1] === marker)
            continue;
        // rule 2: char immediately inside markers must be non-whitespace
        if (isSpaceChar(text[j - 1]))
            continue;
        // rule 1: char after closing must be end / whitespace / punctuation
        if (j + 1 < text.length) {
            const after = text[j + 1];
            if (!isSpaceChar(after) && !isPunct(after))
                continue;
        }
        return j;
    }
    return 0;
}
function findCodeClose(text, start) {
    for (let j = start; j < text.length; j++) {
        if (text[j] === '\n')
            return 0;
        if (text[j] === '`')
            return j;
    }
    return 0;
}
function findLinkClose(text, start) {
    for (let j = start; j < text.length; j++) {
        if (text[j] === '\n')
            return 0;
        if (text[j] === '>')
            return j;
    }
    return 0;
}
function splitLink(inner) {
    const idx = inner.indexOf('|');
    if (idx >= 0)
        return { url: inner.slice(0, idx), label: inner.slice(idx + 1) };
    return { url: inner, label: inner };
}
function matchBareURL(text, i) {
    const lower = text.slice(i).toLowerCase();
    let prefixLen = 0;
    if (lower.startsWith('https://'))
        prefixLen = 8;
    else if (lower.startsWith('http://'))
        prefixLen = 7;
    else
        return null;
    let end = i + prefixLen;
    while (end < text.length && !isSpaceChar(text[end]))
        end++;
    if (end === i + prefixLen)
        return null; // scheme only
    let url = text.slice(i, end);
    while (url.length > prefixLen) {
        const last = url[url.length - 1];
        if ('.,;:)]!'.includes(last))
            url = url.slice(0, -1);
        else
            break;
    }
    if (url.length <= prefixLen)
        return null;
    return { url, advance: url.length };
}
// -------- plaintext --------
function blockToPlain(n) {
    switch (n.type) {
        case 'paragraph':
            return inlineToPlain(n.children);
        case 'blockquote': {
            const inner = n.children.map(blockToPlain).join('\n');
            return inner.split('\n').map((line) => '> ' + line).join('\n');
        }
        case 'list': {
            return n.items
                .map((item, idx) => {
                const prefix = n.ordered ? `${idx + 1}. ` : '- ';
                return prefix + item.map(blockToPlain).join('\n');
            })
                .join('\n');
        }
        case 'code_block':
            return n.value;
        default:
            return '';
    }
}
function inlineToPlain(ns) {
    let s = '';
    for (const n of ns) {
        switch (n.type) {
            case 'text':
                s += n.value;
                break;
            case 'emphasis':
                s += inlineToPlain(n.children);
                break;
            case 'code_inline':
                s += n.value;
                break;
            case 'link':
                s += inlineToPlain(n.children);
                break;
        }
    }
    return s;
}
//# sourceMappingURL=parser.js.map