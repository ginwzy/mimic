export const XHR = 'window.XMLHttpRequest';
export const XHR_SEND = 'window.XMLHttpRequest.prototype.send';
export const NAV = 'window.Navigator';
export const BEACON = 'window.Navigator.prototype.sendBeacon';
export const FETCH = 'window.fetch';
export const ARRAY_BUFFER = 'window.ArrayBuffer';
export const RESPONSE_PROTO = 'net.response.proto';

export type Mode = 'capture' | 'forward';
export type Via = 'xhr' | 'beacon' | 'fetch';
export type NetConfig =
  | { op: 'request'; via: Via; mode: Mode }
  | { op: 'response-ctor' }
  | { op: 'response-field'; field: 'ok' | 'status' | 'statusText' }
  | { op: 'response-body'; kind: 'text' | 'json' | 'arrayBuffer' };
