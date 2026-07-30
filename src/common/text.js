/**
 * Text and number normalisation.
 *
 * Google Maps renders icon-font glyphs, bidi marks and non-breaking spaces
 * inline with real content, and localises every digit. Both are handled here so
 * the parser can treat what it gets as plain text.
 *
 * Every non-ASCII character in this file is written as an escape on purpose:
 * the whole point of the module is invisible characters, and source you cannot
 * see is source you cannot maintain.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  /**
   * Characters that occupy a text node but carry no meaning for us:
   *   Cc control, Cf format (bidi marks), Co private use, Cs surrogate,
   *   plus the object-replacement and replacement characters.
   *
   * Co matters more than it looks. Maps puts Material icon ligatures such as
   * U+E934 directly in the info row, so a naive read of
   * "Restaurant / <glyph> / 110 E 2nd St" yields three chunks and the address
   * lands in the category column. Stripping private-use characters collapses it
   * back to the two real chunks.
   */
  const JUNK = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\uFFFC\uFFFD]/gu;

  /** Collapse a DOM string to clean, single-spaced, trimmed text. */
  function clean(value) {
    if (value == null) return '';
    return String(value).replace(JUNK, ' ').replace(/\s+/gu, ' ').trim();
  }

  /**
   * Code points of the digit zero for every decimal system Maps is likely to
   * render. Each Unicode decimal range is ten contiguous code points starting
   * at its own zero, so `cp - zero` gives the value directly.
   */
  const DIGIT_ZEROES = [
    0x0030, // ASCII
    0x0660, // Arabic-Indic
    0x06f0, // Extended Arabic-Indic (Persian)
    0x0966, // Devanagari
    0x09e6, // Bengali
    0x0a66, // Gurmukhi
    0x0ae6, // Gujarati
    0x0b66, // Oriya
    0x0be6, // Tamil
    0x0c66, // Telugu
    0x0ce6, // Kannada
    0x0d66, // Malayalam
    0x0e50, // Thai
    0x0ed0, // Lao
    0x0f20, // Tibetan
    0x1040, // Myanmar
    0x17e0, // Khmer
    0x1810, // Mongolian
    0xff10 // Fullwidth
  ];

  function digitValue(cp) {
    for (let i = 0; i < DIGIT_ZEROES.length; i += 1) {
      const d = cp - DIGIT_ZEROES[i];
      if (d >= 0 && d <= 9) return d;
    }
    return -1;
  }

  /** Rewrite every localised decimal digit as ASCII, leaving the rest intact. */
  function toAsciiDigits(value) {
    const s = String(value == null ? '' : value);
    let out = '';
    for (const ch of s) {
      const d = digitValue(ch.codePointAt(0));
      out += d >= 0 ? String(d) : ch;
    }
    return out;
  }

  /** Space-family characters used for digit grouping in fr/ru/sv locales. */
  const GROUPING_SPACES = /[\u00A0\u202F\u2009\u2007]/gu;

  /**
   * Pull the numeric tokens out of a string in document order.
   *   "4.4 stars 677 Reviews"          -> ["4.4", "677"]
   *   "4,8 Sterne 18.188 Rezensionen"  -> ["4,8", "18.188"]
   */
  function numericTokens(value) {
    const ascii = toAsciiDigits(value).replace(GROUPING_SPACES, ' ');
    return ascii.match(/\d[\d., ]*\d|\d/gu) || [];
  }

  /**
   * Interpret one token as an integer. Every separator is a grouping mark,
   * whichever convention the locale uses: "1,234" / "1.234" / "1 234" -> 1234.
   */
  function asInteger(token) {
    if (token == null) return null;
    const digits = toAsciiDigits(token).replace(/\D/gu, '');
    if (!digits) return null;
    const n = Number.parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Interpret one token as a 0-5 rating.
   *
   * A single separator followed by one or two digits is a decimal point in any
   * locale ("4.9", "4,9"); anything else is grouping. Values outside 0-5 are
   * rejected rather than guessed, so a mis-read surfaces as "no rating" instead
   * of a plausible-looking wrong number.
   */
  function asRating(token) {
    if (token == null) return null;
    const t = toAsciiDigits(token).trim();
    const decimal = t.match(/^(\d+)[.,](\d{1,2})$/u);
    let value;
    if (decimal) {
      value = Number.parseFloat(decimal[1] + '.' + decimal[2]);
    } else {
      const digits = t.replace(/\D/gu, '');
      if (!digits) return null;
      value = Number.parseInt(digits, 10);
    }
    if (!Number.isFinite(value) || value < 0 || value > 5) return null;
    return Math.round(value * 10) / 10;
  }

  /** Format an integer for display using the browser's locale. */
  function formatCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    try {
      return n.toLocaleString();
    } catch (_) {
      return String(n);
    }
  }

  /**
   * Turn a search query into a filename-safe slug.
   * "Plumbers in Austin, TX" -> "plumbers-in-austin-tx"
   */
  function slug(value, maxLength) {
    const limit = maxLength || 40;
    const base = clean(value)
      .toLowerCase()
      // Marks (\p{M}) have to survive alongside letters and numbers: the
      // Devanagari virama and anusvara in a query like "प्लंबर" are combining
      // marks, and dropping them turns the word into "प-ल-बर".
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    if (!base) return '';
    if (base.length <= limit) return base;
    // Cut on a separator so the name never ends mid-word.
    const cut = base.slice(0, limit);
    const lastDash = cut.lastIndexOf('-');
    return (lastDash > limit * 0.5 ? cut.slice(0, lastDash) : cut).replace(/-+$/u, '');
  }

  MLE.text = { clean, toAsciiDigits, numericTokens, asInteger, asRating, formatCount, slug };
})(typeof self !== 'undefined' ? self : this);
