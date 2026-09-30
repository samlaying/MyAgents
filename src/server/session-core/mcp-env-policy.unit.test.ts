import { describe, expect, it } from 'vitest';

import {
  MCP_LOCALHOST_NO_PROXY_VAL,
  buildMcpSubprocessEnv,
} from './mcp-env-policy';

describe('mcp-env-policy', () => {
  it('injects localhost NO_PROXY protection when the MCP has no explicit override', () => {
    const env = buildMcpSubprocessEnv({
      HTTPS_PROXY: 'http://proxy.local:7890',
      NO_PROXY: 'dirty-system-value',
      no_proxy: 'dirty-system-value',
    }, undefined);

    expect(env.HTTPS_PROXY).toBe('http://proxy.local:7890');
    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.NO_PROXY?.split(',')).not.toContain('[::1]');
  });

  it('merges per-server NO_PROXY with mandatory localhost protection and mirrors the other casing', () => {
    const env = buildMcpSubprocessEnv({
      NO_PROXY: 'localhost,127.0.0.1,[::1]',
      no_proxy: 'localhost,127.0.0.1,[::1]',
    }, {
      NO_PROXY: '.corp.local',
    });

    expect(env.NO_PROXY).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
  });

  it('preserves explicit per-server values for both casings while keeping localhost protection', () => {
    const env = buildMcpSubprocessEnv({}, {
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1,.corp.local',
      MINERU_API_TOKEN: 'token',
    });

    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.MINERU_API_TOKEN).toBe('token');
  });

  it('mirrors a lowercase-only per-server no_proxy override to uppercase', () => {
    const env = buildMcpSubprocessEnv({}, {
      no_proxy: '.corp.local',
    });

    expect(env.NO_PROXY).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
  });

  it('drops the invalid bracketed IPv6 URL form from an explicit server override', () => {
    const env = buildMcpSubprocessEnv({}, {
      NO_PROXY: '[::1],.corp.local',
    });

    expect(env.NO_PROXY).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
    expect(env.no_proxy).toBe(`${MCP_LOCALHOST_NO_PROXY_VAL},.corp.local`);
  });

  it('treats empty per-server NO_PROXY values as absent to keep localhost protection', () => {
    const env = buildMcpSubprocessEnv({}, {
      NO_PROXY: '',
      no_proxy: '   ',
    });

    expect(env.NO_PROXY).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
    expect(env.no_proxy).toBe(MCP_LOCALHOST_NO_PROXY_VAL);
  });

  it('enables NODE_USE_ENV_PROXY so Node children actually use the forwarded proxy', () => {
    const uppercase = buildMcpSubprocessEnv({
      HTTPS_PROXY: 'http://proxy.local:7890',
    }, undefined);
    const lowercase = buildMcpSubprocessEnv({
      https_proxy: 'http://proxy.local:7890',
    }, undefined);

    expect(uppercase.NODE_USE_ENV_PROXY).toBe('1');
    expect(lowercase.NODE_USE_ENV_PROXY).toBe('1');
  });

  it('leaves NODE_USE_ENV_PROXY unset when no outbound proxy is forwarded', () => {
    const env = buildMcpSubprocessEnv({
      NO_PROXY: 'example.test',
    }, {
      TAVILY_API_KEY_1: 'key',
    });

    expect(env.NODE_USE_ENV_PROXY).toBeUndefined();
  });

  it('lets an explicit per-server NODE_USE_ENV_PROXY override the injected default', () => {
    const env = buildMcpSubprocessEnv({
      HTTPS_PROXY: 'http://proxy.local:7890',
    }, {
      NODE_USE_ENV_PROXY: '0',
    });

    expect(env.NODE_USE_ENV_PROXY).toBe('0');
  });
});
