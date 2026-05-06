// snowApi.ts — ServiceNow API client routed through the Express SNow proxy.

const SNOW_PROXY_BASE = '/snow-proxy';

/** Additional fetch options accepted by the ServiceNow proxy client. */
export interface SnowFetchOptions extends RequestInit {
  /** If true, always use the direct proxy even if relay is active. */
  forceDirectProxy?: boolean;
}

function assertSuccessfulResponse(response: Response, path: string): void {
  if (!response.ok) {
    throw new Error(`SNow fetch ${path} failed: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

function removeRelayOnlyOptions(options: SnowFetchOptions): RequestInit {
  const fetchOptions: SnowFetchOptions = { ...options };
  delete fetchOptions.forceDirectProxy;
  return fetchOptions;
}

/** Fetches a ServiceNow resource via the proxy. */
export async function snowFetch<ResponseBody>(
  path: string,
  options: SnowFetchOptions = {},
): Promise<ResponseBody> {
  const fetchOptions = removeRelayOnlyOptions(options);
  const response = await fetch(`${SNOW_PROXY_BASE}${path}`, fetchOptions);

  assertSuccessfulResponse(response, path);
  return parseJsonResponse<ResponseBody>(response);
}
