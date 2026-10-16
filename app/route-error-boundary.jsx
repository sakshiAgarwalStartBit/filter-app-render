import { useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

// Shopify needs React Router to catch some thrown responses, so that their
// headers are included in the response. Some of those thrown Responses (e.g.
// the embedded-app bootstrap redirect) reach boundary.error() as an
// ErrorResponse/ErrorResponseImpl. boundary.error() renders `error.data` as
// raw dangerouslySetInnerHTML, falling back to the literal string
// "Handling response" when `error.data` is falsy. In practice, when the
// browser's fetch auto-follows the bounce redirect during a client-side
// navigation (React Router's `.data` protocol), the final response's status
// gets surfaced as `error.data` (e.g. the string "200") instead of real HTML
// — which is truthy, so it isn't caught by an `!error.data` check and gets
// dumped onto the page as visible text. None of these bounce/redirect
// responses ever carry real error markup, so treat any bare route-error
// response (no structured error info beyond a raw status-like payload) as
// "render nothing" rather than trying to enumerate every falsy/placeholder
// shape it might arrive in.
//
// Every route whose loader calls authenticate.admin needs its own copy of
// this (not just the parent app.jsx route) — a child route's loader can
// throw the bounce response on a client-side navigation without the error
// bubbling through the parent's ErrorBoundary.
function isBounceResponseData(data) {
  if (!data) return true;
  // Real error HTML from boundary.error()'s known shapes always contains
  // markup; a bounce/redirect leak is just a bare status code or short
  // status text with no tags.
  return typeof data === "string" && !/[<>]/.test(data);
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && isBounceResponseData(error.data)) {
    return null;
  }
  return boundary.error(error);
}
