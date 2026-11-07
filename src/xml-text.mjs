// XML 1.0 permits tab, LF and CR, but excludes other C0 controls and lone surrogates.
export function assertXmlText(value) {
  if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    throw new Error('INVALID_XML_TEXT');
  }
}

export function assertXmlStrings(value) {
  if (typeof value === 'string') assertXmlText(value);
  else if (Array.isArray(value)) value.forEach(assertXmlStrings);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertXmlStrings);
}
