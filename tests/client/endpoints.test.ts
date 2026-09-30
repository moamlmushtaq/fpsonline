import { describe, expect, it } from 'vitest';
import { resolveServerEndpoints } from '../../src/client/net/endpoints';

const page = (href: string) => {
  const u = new URL(href);
  return { search: u.search, protocol: u.protocol, host: u.host, origin: u.origin, href: u.href };
};

describe('resolveServerEndpoints', () => {
  it('uses the page origin by default', () => {
    expect(resolveServerEndpoints(page('https://play.example.com/?debug=1'))).toEqual({ ws: 'wss://play.example.com/ws', status: 'https://play.example.com/api/status' });
    expect(resolveServerEndpoints(page('http://localhost:8080/'))).toEqual({ ws: 'ws://localhost:8080/ws', status: 'http://localhost:8080/api/status' });
  });

  it('honours ?server= in its common spellings', () => {
    expect(resolveServerEndpoints(page('https://cdn.example.com/game/?server=wss://srv.example.com/ws'))).toEqual({ ws: 'wss://srv.example.com/ws', status: 'https://srv.example.com/api/status' });
    expect(resolveServerEndpoints(page('http://x/?server=ws://10.0.0.2:8080'))).toEqual({ ws: 'ws://10.0.0.2:8080/ws', status: 'http://10.0.0.2:8080/api/status' });
    expect(resolveServerEndpoints(page('http://x/?server=https://srv.example.com'))).toEqual({ ws: 'wss://srv.example.com/ws', status: 'https://srv.example.com/api/status' });
  });

  it('has no server for file:// pages', () => {
    expect(resolveServerEndpoints({ search: '', protocol: 'file:', host: '', origin: 'null', href: 'file:///index.html' })).toEqual({ ws: '', status: '' });
  });
});
