// A capture is pixels; a design tool needs to know what is where. Next to each capture the runtime
// records every `data-node-id` element's page box, nearest node ancestor, text, and state, so an
// export can place design-system instances where the wireframe drew them.
//
// Repeated items share a node id, so each row carries its `occurrence` in document order, and
// its parent's occurrence so a child lands in the right repeated item.
// `text` is the element's own text only: a container's innerText repeats every child's text, and
// a design tool drawing both would print the children twice.
//
// Authored renderers also draw things no node id names — a page title, a label inside a region, a
// spinner. Leaving them out exports a screen emptier than its capture, so every other element that
// shows its own text, a background, or a border is kept as a `decoration` of its nearest node.

export const LAYOUT_SCHEMA_VERSION = 1;

export async function captureLayout(page) {
  const snapshot = await page.evaluate(() => {
    const seen = new Map();
    const occurrences = new Map();
    const elements = [...document.querySelectorAll('[data-node-id]')];
    for (const el of elements) {
      const nodeId = el.getAttribute('data-node-id');
      occurrences.set(el, seen.get(nodeId) ?? 0);
      seen.set(nodeId, occurrences.get(el) + 1);
    }
    const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    // Each direct text node where it actually renders: in `<p><b>3,200</b>원</p>` the 원 sits after
    // the number, not at the paragraph's origin.
    const textRuns = (el) => [...el.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE && clean(child.textContent))
      .map((child) => {
        const range = document.createRange();
        range.selectNodeContents(child);
        const rect = range.getBoundingClientRect();
        return {text: clean(child.textContent),
          box: {x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height}};
      });
    const ownText = (el) => textRuns(el).map((run) => run.text).join(' ');
    const owner = (el) => el.parentElement?.closest('[data-node-id]') ?? null;
    const transparent = (color) => !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const border = Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].map((side) => [side.toLowerCase(), {
        width: style[`border${side}Style`] === 'none' ? 0 : parseFloat(style[`border${side}Width`]) || 0,
        color: style[`border${side}Color`],
      }]));
      const parent = owner(el);
      return {
        parentNodeId: parent ? parent.getAttribute('data-node-id') : null,
        parentOccurrence: parent ? occurrences.get(parent) : null,
        tag: el.tagName.toLowerCase(),
        box: {x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height},
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        text: ownText(el),
        textRuns: textRuns(el),
        // What the capture shows, so an element without a library component is drawn as rendered,
        // not re-styled by guesswork.
        style: {
          color: style.color, backgroundColor: style.backgroundColor,
          fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) || 400,
          lineHeight: style.lineHeight, textAlign: style.textAlign,
          borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
          border,
        },
      };
    };
    const nodes = elements.map((el) => {
      const aria = (name) => el.getAttribute(name) === 'true';
      const described = describe(el);
      return {
        nodeId: el.getAttribute('data-node-id'),
        occurrence: occurrences.get(el),
        ...described,
        label: clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || ''),
        role: el.getAttribute('role') ?? '',
        state: {
          disabled: el.disabled === true || aria('aria-disabled'),
          checked: el.checked === true || aria('aria-checked'),
          selected: aria('aria-selected'),
          expanded: aria('aria-expanded'),
          busy: aria('aria-busy'),
          value: 'value' in el && typeof el.value === 'string' ? el.value : '',
        },
      };
    });
    const decorations = [...document.body.querySelectorAll('*')]
      .filter((el) => !el.hasAttribute('data-node-id') && !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName))
      .map((el) => ({el, described: describe(el)}))
      .filter(({described}) => described.text || !transparent(described.style.backgroundColor) ||
        Object.values(described.style.border).some((side) => side.width > 0))
      .map(({el, described}, index) => ({index, className: typeof el.className === 'string' ? el.className : '',
        ...described}));
    const root = document.documentElement;
    return {
      viewport: {width: window.innerWidth, height: window.innerHeight,
        scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight},
      nodes,
      decorations,
    };
  });
  return {schemaVersion: LAYOUT_SCHEMA_VERSION, ...snapshot};
}
