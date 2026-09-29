import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
});

describe('DOM storage environment', () => {
  it('uses browser Storage for both global and window access', () => {
    expect(localStorage).toBeInstanceOf(Storage);
    expect(localStorage).toBe(window.localStorage);
    localStorage.clear();
    localStorage.setItem('progress', JSON.stringify(['lesson-1']));
    expect(window.localStorage.getItem('progress')).toBe('["lesson-1"]');
    expect(localStorage.key(0)).toBe('progress');
    expect(localStorage.length).toBe(1);
    localStorage.removeItem('progress');
    expect(localStorage.getItem('progress')).toBeNull();
  });

  it('isolates session storage from local storage', () => {
    expect(sessionStorage).toBeInstanceOf(Storage);
    sessionStorage.setItem('scope', 'session');
    expect(localStorage.getItem('scope')).toBeNull();
    expect(window.sessionStorage.getItem('scope')).toBe('session');
  });
});
