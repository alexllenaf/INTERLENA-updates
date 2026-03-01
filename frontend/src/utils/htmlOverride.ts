export const HTML_OVERRIDE_SCOPE_CLASS = "block-html-override-scope";

const DISALLOWED_TAG_NAMES = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base"
]);

const URL_ATTRIBUTES = new Set(["href", "src", "poster", "action", "formaction", "xlink:href"]);
const TYPOGRAPHY_BLOCKED_PROPERTIES = new Set(["font", "font-family"]);
const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const MEDIA_RULE = 4;
const FONT_FACE_RULE = 5;
const PAGE_RULE = 6;
const KEYFRAMES_RULE = 7;
const KEYFRAME_RULE = 8;
const SUPPORTS_RULE = 12;

const normalizeUrl = (value: string): string =>
  value
    .trim()
    .replace(/[\u0000-\u001f\u007f\s]+/g, "")
    .toLowerCase();

const isUnsafeUrl = (value: string): boolean => {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:")) return true;
  if (normalized.startsWith("data:") && !normalized.startsWith("data:image/") && !normalized.startsWith("data:font/")) {
    return true;
  }
  return false;
};

const sanitizeCssValue = (property: string, value: string): string | null => {
  const prop = property.trim().toLowerCase();
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (TYPOGRAPHY_BLOCKED_PROPERTIES.has(prop)) return null;
  if (prop === "position" && /\bfixed\b/i.test(trimmed)) return null;
  if (/@import/i.test(trimmed)) return null;
  if (/expression\s*\(/i.test(trimmed)) return null;
  if (/javascript:/i.test(trimmed) || /vbscript:/i.test(trimmed)) return null;
  return trimmed;
};

const serializeStyleDeclaration = (style: CSSStyleDeclaration): string => {
  const declarations: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const property = style.item(i);
    const nextValue = sanitizeCssValue(property, style.getPropertyValue(property));
    if (!nextValue) continue;
    const priority = style.getPropertyPriority(property);
    declarations.push(`${property}: ${nextValue}${priority ? " !important" : ""};`);
  }
  return declarations.join(" ");
};

const sanitizeInlineStyle = (styleText: string): string => {
  if (typeof document === "undefined" || !styleText.trim()) return "";
  try {
    const doc = document.implementation.createHTMLDocument("");
    const node = doc.createElement("div");
    node.setAttribute("style", styleText);
    return serializeStyleDeclaration(node.style);
  } catch {
    return "";
  }
};

const splitSelectorList = (selectorText: string): string[] => {
  const selectors: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBracket = 0;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];
    const prev = selectorText[i - 1];

    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") {
      depthParen += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      current += char;
      continue;
    }

    if (char === "[") {
      depthBracket += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      current += char;
      continue;
    }

    if (char === "," && depthParen === 0 && depthBracket === 0) {
      selectors.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) selectors.push(current.trim());
  return selectors;
};

const replaceRootSelectors = (selector: string): string =>
  selector
    .replace(/(^|[\s>+~,(])(:root)(?=[\s>+~.#[:),]|$)/g, `$1.${HTML_OVERRIDE_SCOPE_CLASS}`)
    .replace(/(^|[\s>+~,(])(html)(?=[\s>+~.#[:),]|$)/g, `$1.${HTML_OVERRIDE_SCOPE_CLASS}`)
    .replace(/(^|[\s>+~,(])(body)(?=[\s>+~.#[:),]|$)/g, `$1.${HTML_OVERRIDE_SCOPE_CLASS}`)
    .replace(/:host\b/g, `.${HTML_OVERRIDE_SCOPE_CLASS}`);

const scopeSelector = (selector: string): string => {
  const trimmed = selector.trim();
  if (!trimmed) return `.${HTML_OVERRIDE_SCOPE_CLASS}`;
  const normalized = replaceRootSelectors(trimmed);
  if (normalized.includes(`.${HTML_OVERRIDE_SCOPE_CLASS}`)) return normalized;
  if (normalized === "*") return `.${HTML_OVERRIDE_SCOPE_CLASS} *`;
  return `.${HTML_OVERRIDE_SCOPE_CLASS} ${normalized}`;
};

const serializeScopedCssRule = (rule: CSSRule): string => {
  if (rule.type === STYLE_RULE) {
    const styleRule = rule as CSSStyleRule;
    const selectors = splitSelectorList(styleRule.selectorText)
      .map(scopeSelector)
      .filter(Boolean)
      .join(", ");
    const declarations = serializeStyleDeclaration(styleRule.style);
    if (!selectors || !declarations) return "";
    return `${selectors} { ${declarations} }`;
  }

  if (rule.type === KEYFRAMES_RULE) {
    const keyframesRule = rule as CSSKeyframesRule;
    const frames = Array.from(keyframesRule.cssRules)
      .map((frameRule) => {
        if (frameRule.type !== KEYFRAME_RULE) return "";
        const keyframe = frameRule as CSSKeyframeRule;
        const declarations = serializeStyleDeclaration(keyframe.style);
        if (!declarations) return "";
        return `${keyframe.keyText} { ${declarations} }`;
      })
      .filter(Boolean)
      .join(" ");
    if (!frames) return "";
    return `@keyframes ${keyframesRule.name} { ${frames} }`;
  }

  if (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE) {
    const cssText = rule.cssText;
    const blockStart = cssText.indexOf("{");
    if (blockStart === -1 || !("cssRules" in rule)) return "";
    const header = cssText.slice(0, blockStart).trim();
    const inner = Array.from((rule as CSSGroupingRule).cssRules)
      .map(serializeScopedCssRule)
      .filter(Boolean)
      .join("\n");
    if (!inner) return "";
    return `${header} { ${inner} }`;
  }

  if (rule.type === IMPORT_RULE || rule.type === FONT_FACE_RULE || rule.type === PAGE_RULE) {
    return "";
  }

  return "";
};

const scopeCssText = (cssText: string): string => {
  if (typeof document === "undefined" || !cssText.trim()) return "";

  try {
    const doc = document.implementation.createHTMLDocument("");
    const style = doc.createElement("style");
    style.textContent = cssText;
    doc.head.append(style);
    const sheet = style.sheet as CSSStyleSheet | null;
    if (!sheet) return "";
    return Array.from(sheet.cssRules)
      .map(serializeScopedCssRule)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
};

const sanitizeElementAttributes = (element: Element) => {
  Array.from(element.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith("on")) {
      element.removeAttribute(attr.name);
      return;
    }

    if (name === "style") {
      const sanitized = sanitizeInlineStyle(value);
      if (sanitized) element.setAttribute("style", sanitized);
      else element.removeAttribute(attr.name);
      return;
    }

    if (URL_ATTRIBUTES.has(name) && isUnsafeUrl(value)) {
      element.removeAttribute(attr.name);
      return;
    }
  });

  if (element instanceof HTMLAnchorElement && element.target === "_blank") {
    const rel = new Set((element.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    element.setAttribute("rel", Array.from(rel).join(" "));
  }
};

export const sanitizeHtmlOverride = (html: string): string => {
  if (typeof DOMParser === "undefined" || !html.trim()) return html.trim();

  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const sanitizedStyles = Array.from(parsed.querySelectorAll("style"))
      .map((styleNode) => scopeCssText(styleNode.textContent || ""))
      .filter(Boolean);
    parsed.querySelectorAll("style").forEach((styleNode) => styleNode.remove());

    Array.from(parsed.body.querySelectorAll("*")).forEach((element) => {
      if (DISALLOWED_TAG_NAMES.has(element.tagName.toLowerCase())) {
        element.remove();
        return;
      }
      sanitizeElementAttributes(element);
    });

    const stylePrefix = sanitizedStyles.map((css) => `<style>${css}</style>`).join("");
    return `${stylePrefix}${parsed.body.innerHTML}`.trim();
  } catch {
    return html.trim();
  }
};
