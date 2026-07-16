/**
 * localStore.js — Local-First Datastore
 *
 * Drop-in replacement for the Firestore subset this app used
 * (collection/doc, get/set/update/add/delete, where/orderBy/limit,
 * FieldValue.serverTimestamp/arrayUnion/arrayRemove).
 *
 * Everything is stored in a single JSON file on disk. No network,
 * no external account, no vendor — matches AXON's local-first principle.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.AXON_DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "axon-store.json");

let state = null;
let writeQueue = Promise.resolve();

function load() {
  if (state) return state;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } else {
    state = {};
    persist();
  }

  return state;
}

function persist() {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = `${DATA_FILE}.tmp`;
        fs.writeFile(tmp, JSON.stringify(state, null, 2), (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DATA_FILE, (renameErr) => {
            if (renameErr) return reject(renameErr);
            resolve();
          });
        });
      })
  );
  return writeQueue;
}

function getPathNode(segments, create) {
  let node = load();
  for (const seg of segments) {
    if (!node[seg]) {
      if (!create) return null;
      node[seg] = {};
    }
    node = node[seg];
  }
  return node;
}

class FieldValueMarker {
  constructor(kind, value) {
    this.kind = kind;
    this.value = value;
  }
}

const FieldValue = {
  serverTimestamp: () => new FieldValueMarker("serverTimestamp"),
  arrayUnion: (...items) => new FieldValueMarker("arrayUnion", items),
  arrayRemove: (...items) => new FieldValueMarker("arrayRemove", items),
};

function applyFieldValues(existing, patch) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValueMarker) {
      if (value.kind === "serverTimestamp") {
        result[key] = new Date().toISOString();
      } else if (value.kind === "arrayUnion") {
        const arr = Array.isArray(result[key]) ? result[key] : [];
        result[key] = [...new Set([...arr, ...value.value])];
      } else if (value.kind === "arrayRemove") {
        const arr = Array.isArray(result[key]) ? result[key] : [];
        const removeSet = new Set(value.value);
        result[key] = arr.filter((item) => !removeSet.has(item));
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

class DocRef {
  constructor(segments) {
    this.segments = segments;
    this.id = segments[segments.length - 1];
  }

  collection(name) {
    return new CollectionRef([...this.segments, "__sub__", name]);
  }

  async get() {
    const node = getPathNode(this.segments, false);
    const data = node && node.__data__ ? node.__data__ : null;
    return {
      exists: !!data,
      id: this.id,
      data: () => (data ? { ...data } : undefined),
    };
  }

  async set(value, options = {}) {
    const parent = getPathNode(this.segments.slice(0, -1), true);
    const key = this.segments[this.segments.length - 1];
    if (!parent[key]) parent[key] = {};

    const existing = parent[key].__data__ || {};
    const merged = options.merge
      ? applyFieldValues(existing, value)
      : applyFieldValues({}, value);

    parent[key].__data__ = merged;
    await persist();
  }

  async update(patch) {
    const node = getPathNode(this.segments, false);
    if (!node || !node.__data__) {
      throw new Error(`[LOCAL_STORE] update() called on non-existent doc: ${this.segments.join("/")}`);
    }
    node.__data__ = applyFieldValues(node.__data__, patch);
    await persist();
  }

  async delete() {
    const parent = getPathNode(this.segments.slice(0, -1), false);
    const key = this.segments[this.segments.length - 1];
    if (parent) delete parent[key];
    await persist();
  }
}

class CollectionRef {
  constructor(segments, filters = [], order = null, limitN = null) {
    this.segments = segments;
    this._filters = filters;
    this._order = order;
    this._limit = limitN;
  }

  doc(id) {
    const docId = id || crypto.randomUUID();
    return new DocRef([...this.segments, docId]);
  }

  where(field, op, value) {
    return new CollectionRef(this.segments, [...this._filters, { field, op, value }], this._order, this._limit);
  }

  orderBy(field, direction = "asc") {
    return new CollectionRef(this.segments, this._filters, { field, direction }, this._limit);
  }

  limit(n) {
    return new CollectionRef(this.segments, this._filters, this._order, n);
  }

  async add(value) {
    const ref = this.doc();
    await ref.set(value);
    return ref;
  }

  _readAllDocs() {
    const node = getPathNode(this.segments, false) || {};
    const docs = [];
    for (const [id, child] of Object.entries(node)) {
      if (child && typeof child === "object" && child.__data__) {
        docs.push({ id, data: { ...child.__data__ } });
      }
    }
    return docs;
  }

  async get() {
    let docs = this._readAllDocs();

    for (const f of this._filters) {
      docs = docs.filter((d) => {
        const val = d.data[f.field];
        switch (f.op) {
          case "==":
            return val === f.value;
          case "!=":
            return val !== f.value;
          case ">=":
            return val >= f.value;
          case "<=":
            return val <= f.value;
          case ">":
            return val > f.value;
          case "<":
            return val < f.value;
          default:
            return true;
        }
      });
    }

    if (this._order) {
      const { field, direction } = this._order;
      docs.sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return direction === "desc" ? -cmp : cmp;
      });
    }

    if (this._limit != null) {
      docs = docs.slice(0, this._limit);
    }

    return {
      empty: docs.length === 0,
      docs: docs.map((d) => ({
        id: d.id,
        exists: true,
        data: () => ({ ...d.data }),
      })),
    };
  }
}

function collection(name) {
  return new CollectionRef([name]);
}

module.exports = {
  collection,
  FieldValue,
};
