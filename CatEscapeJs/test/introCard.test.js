/**
 * Intro card tests (spec 13.4): the card shows the icon, the name and the
 * one-line rule of the level's `new` gimmick and closes on OK.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIntroCard } from '../src/ui/introCard.js';
import { STRINGS } from '../src/ui/strings.js';

function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    id: '',
    hidden: false,
    attributes: {},
    children: [],
    style: {},
    textContent: '',
    listeners: {},
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attributes ? this.attributes[k] : null;
    },
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
}

function stubDocument() {
  const body = makeNode('body');
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createElementNS: (_ns, tag) => makeNode(tag),
    body,
  };
  return body;
}

function findAll(node, pred) {
  const out = [];
  const walk = (n) => {
    if (pred(n)) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

describe('intro cards (13.4)', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  it('shows the name and rule of the gimmick and closes on OK', () => {
    const body = stubDocument();
    const card = createIntroCard({ strings: STRINGS.ja });
    expect(card.isOpen()).toBe(false);
    card.show('tunnel');
    expect(card.isOpen()).toBe(true);

    const name = findAll(body, (n) => n.id === 'intro-name')[0];
    const rule = findAll(body, (n) => n.id === 'intro-rule')[0];
    const icon = findAll(body, (n) => n.id === 'intro-icon')[0];
    expect(name.textContent).toBe(STRINGS.ja.introNameTunnel);
    expect(rule.textContent).toBe(STRINGS.ja.introRuleTunnel);
    expect(icon.children.length).toBe(1); // the labeled gimmick icon

    const ok = findAll(body, (n) => n.id === 'intro-ok')[0];
    expect(ok.textContent).toBe(STRINGS.ja.close);
    ok.listeners.click();
    expect(card.isOpen()).toBe(false);
  });

  it('multi-cat intros explain the goal', () => {
    const body = stubDocument();
    const card = createIntroCard({ strings: STRINGS.en });
    card.show('cats3Catch');
    const name = findAll(body, (n) => n.id === 'intro-name')[0];
    const rule = findAll(body, (n) => n.id === 'intro-rule')[0];
    expect(name.textContent).toBe(STRINGS.en.introNameCats3Catch);
    expect(rule.textContent).toBe(STRINGS.en.introRuleCats3Catch);
  });
});
