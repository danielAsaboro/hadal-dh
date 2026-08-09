import type { ChangeCase } from "../domain/case";

const keyPattern = /^[a-f0-9]{24}$/;
const markerPattern = /<!-- (?:changemarshal|cutset)-work-key:([a-f0-9]{24}) -->/g;

export function workMarker(workKey: string): string {
  if (!keyPattern.test(workKey)) throw new Error("invalid ChangeMarshal work key");
  return `<!-- changemarshal-work-key:${workKey} -->`;
}

export function caseMarker(value: ChangeCase): string {
  const head = value.revision.headSha;
  if (!/^[A-Za-z0-9._-]+$/.test(head)) throw new Error("invalid Git head for marker");
  return `<!-- changemarshal-case:${value.caseKey};revision:${value.revision.revisionKey};head:${head} -->`;
}

export function workKeysIn(body: string): readonly string[] {
  return [...body.matchAll(markerPattern)].map((match) => match[1] as string);
}
