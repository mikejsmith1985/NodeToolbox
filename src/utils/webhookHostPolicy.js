// src/utils/webhookHostPolicy.js — Outbound webhook destination allow-list.
//
// Security boundary for the Report Webhook Delivery feature: a report payload may
// only ever be POSTed to an Atlassian Automation host. This stops the delivery
// pipeline from being pointed at an arbitrary endpoint (the data-exfiltration
// guard required by the spec) regardless of what a stored config might contain.

'use strict';

// The only destinations a payload may be sent to: Atlassian-owned hosts. Matching
// is an exact hostname or a dot-prefixed suffix — never a substring test — so
// look-alike hosts are rejected. Every outbound webhook (report delivery, Rovo
// dispatch, and the Hygiene Monitor digest) targets an Atlassian Automation rule;
// the digest email is composed by that rule, so no non-Atlassian destination
// (e.g. a Microsoft Teams incoming webhook) is permitted.
const ALLOWED_EXACT_HOSTS = [];
const ALLOWED_HOST_SUFFIXES = ['.atlassian.net', '.atlassian.com'];

/**
 * Evaluates whether a webhook URL is an allowed Atlassian Automation destination.
 * Requires HTTPS and an Atlassian host; anything else is rejected with a reason.
 *
 * @param {string} webhookUrl - Candidate destination URL.
 * @returns {{ allowed: boolean, reason: string }}
 */
function evaluateHost(webhookUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch (urlParseError) {
    return { allowed: false, reason: 'Destination is not a valid URL.' };
  }

  // HTTPS is mandatory — report content must never travel in cleartext.
  if (parsedUrl.protocol !== 'https:') {
    return { allowed: false, reason: 'Destination must use HTTPS.' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isExactMatch = ALLOWED_EXACT_HOSTS.includes(hostname);
  const isSuffixMatch = ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

  if (isExactMatch || isSuffixMatch) {
    return { allowed: true, reason: 'Allowed Atlassian host.' };
  }
  return {
    allowed: false,
    reason: 'Destination host is not an allowed Atlassian host; nothing was sent.',
  };
}

/**
 * Convenience boolean wrapper around evaluateHost.
 *
 * @param {string} webhookUrl - Candidate destination URL.
 * @returns {boolean} True only when the URL is an allowed Atlassian HTTPS host.
 */
function isAllowed(webhookUrl) {
  return evaluateHost(webhookUrl).allowed;
}

module.exports = { evaluateHost, isAllowed, ALLOWED_EXACT_HOSTS, ALLOWED_HOST_SUFFIXES };
