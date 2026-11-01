import { classifyEdgeCountry } from "../../shared/new-plan-policy.ts";

type CloudflareRequest = Request & { cf?: { country?: unknown } };

/** Read-only Pages endpoint. Request.cf is supplied by Cloudflare; caller headers
 * and query parameters are deliberately not consulted as location evidence. */
export const onRequestGet = async ({ request }: { request: Request }) => {
  const location = classifyEdgeCountry((request as CloudflareRequest).cf?.country);
  return Response.json({ status: "success", location }, {
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
};
