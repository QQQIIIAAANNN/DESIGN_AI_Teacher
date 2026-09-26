import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function readJsonl(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${rel} line ${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

const topicsTaxonomy = readJson("knowledge/taxonomies/topics.json");
const knowledgeTypes = readJson("knowledge/taxonomies/knowledge-types.json");
const sources = readJsonl("knowledge/manifests/sources.jsonl");
const units = [...readJsonl("knowledge/manifests/knowledge_units.jsonl"),
  ...readJsonl("knowledge/manifests/review_coverage_units.jsonl")];

const allowedTopics = new Set(
  Object.values(topicsTaxonomy.topics).flat()
);
const allowedExamTypes = new Set(topicsTaxonomy.exam_types);
const allowedLayers = new Set(topicsTaxonomy.evaluation_layers);
const allowedKnowledgeTypes = new Set(Object.keys(knowledgeTypes));
const sourceIds = new Set(sources.map((source) => source.source_id));
const unitIds = new Set();
const errors = [];

for (const [index, unit] of units.entries()) {
  const label = `knowledge_units.jsonl line ${index + 1} (${unit.knowledge_id ?? "missing id"})`;

  if (!unit.knowledge_id) errors.push(`${label}: missing knowledge_id`);
  if (unitIds.has(unit.knowledge_id)) errors.push(`${label}: duplicate knowledge_id`);
  unitIds.add(unit.knowledge_id);

  if (!sourceIds.has(unit.source_id)) {
    errors.push(`${label}: unknown source_id "${unit.source_id}"`);
  }

  if (!allowedExamTypes.has(unit.exam_type)) {
    errors.push(`${label}: invalid exam_type "${unit.exam_type}"`);
  }

  if (unit.evaluation_layer !== null && !allowedLayers.has(unit.evaluation_layer)) {
    errors.push(`${label}: invalid evaluation_layer "${unit.evaluation_layer}"`);
  }

  if (!allowedKnowledgeTypes.has(unit.knowledge_type)) {
    errors.push(`${label}: invalid knowledge_type "${unit.knowledge_type}"`);
  }

  if (!Array.isArray(unit.topics) || unit.topics.length === 0) {
    errors.push(`${label}: topics must be a non-empty array`);
  } else {
    for (const topic of unit.topics) {
      if (!allowedTopics.has(topic)) {
        errors.push(`${label}: unknown topic "${topic}"`);
      }
    }
  }

  if (!Array.isArray(unit.evidence_targets) || unit.evidence_targets.length === 0) {
    errors.push(`${label}: evidence_targets must be a non-empty array`);
  }

  if (!["raw", "extracted", "reviewed", "canonical"].includes(unit.curation_status)) {
    errors.push(`${label}: invalid curation_status "${unit.curation_status}"`);
  }
}

if (errors.length > 0) {
  console.error("Knowledge validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Knowledge validation passed: ${sources.length} sources, ${units.length} knowledge units, ${allowedTopics.size} registered topics.`
);
