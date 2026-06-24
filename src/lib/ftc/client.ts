const ENDPOINT = "https://api.ftcscout.org/graphql";

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Server-side GraphQL fetch against the public FTCScout API.
 * Runs only on the server (route handlers / server components), which keeps the
 * browser free of CORS issues and lets Next cache responses by `revalidate`.
 */
export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
  revalidate = 300,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      next: { revalidate },
    });
  } catch {
    throw new Error("Could not reach the FTCScout API. Check your connection.");
  }

  if (!res.ok) {
    throw new Error(`FTCScout API returned ${res.status}.`);
  }

  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("FTCScout API returned no data.");
  }
  return json.data;
}
