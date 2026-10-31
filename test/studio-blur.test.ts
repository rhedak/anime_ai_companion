import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blurFeatures, blurProbabilities } from "../src/studio/blur.ts";

// The reference (local_models studio/blur.py, the same model.json) on a fixed grey picture: the port must give the same numbers.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/blur-features.json", import.meta.url), "utf8")) as {
  h: number;
  w: number;
  grey: number[];
  features: number[];
  probabilities: number[];
};

test("the blur check: the features and the chances match the reference on the same picture", () => {
  const grey = Float64Array.from(fixture.grey);
  const features = blurFeatures(grey, fixture.h, fixture.w);
  assert.equal(features.length, fixture.features.length);
  features.forEach((v, i) => assert.ok(Math.abs(v - fixture.features[i]) < 1e-6, `feature ${i}: ${v} vs ${fixture.features[i]}`));
  const probabilities = blurProbabilities(fixture.features);
  probabilities.forEach((p, i) => assert.ok(Math.abs(p - fixture.probabilities[i]) < 1e-9, `level ${i}`));
});
