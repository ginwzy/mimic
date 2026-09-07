import { requestInterceptor, type CookieJar, type ResourcesOptions } from 'jsdom';
import type { NetworkTransport } from '../network/types.js';

export function networkResources(network: NetworkTransport, jar: CookieJar): ResourcesOptions {
  return {
    interceptors: [dispatch => (options, handler) => {
      const details = options as typeof options & { upgrade?: string; opaque?: { origin?: string; withCredentials?: boolean } };
      const context = details.opaque;
      return requestInterceptor(async (request, { element }) => {
        if (details.upgrade) throw new Error('Closed-loop capture does not support protocol upgrades');
        if (element) throw new Error('Closed-loop capture does not load element subresources');
        const response = await network.request(request);
        const sameOrigin = context?.origin === undefined || context.origin === new URL(request.url).origin;
        const preflight = request.method === 'OPTIONS' && request.headers.has('access-control-request-method');
        // jsdom 29 stores cookies at body-end but starts redirect hops at headers.
        // Our bridge buffers the response, so commit redirect cookies before it can follow.
        if ([301, 302, 303, 307, 308].includes(response.status)
          && !preflight && (sameOrigin || context?.withCredentials)) {
          for (const cookie of response.headers.getSetCookie()) jar.setCookieSync(cookie, request.url, { ignoreError: true });
        }
        return response;
      })(dispatch)(options, handler);
    }],
  };
}
