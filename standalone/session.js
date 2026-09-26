// Keep only validated settings; analysis results are deliberately not persisted.
export const SESSION_KEY = 'kleo.orbit-lab.session.v1';

export function loadSession(storage, validate) {
  const raw = storage.getItem(SESSION_KEY);
  if (raw === null) return null;
  const record = JSON.parse(raw);
  if (record?.version !== 1 || !Number.isFinite(record.savedAt)) throw Error('저장 형식 오류');
  return {scenario: validate(record.scenario), savedAt: record.savedAt};
}

export function saveSession(storage, scenario, validate) {
  const record = {version: 1, savedAt: Date.now(), scenario: validate(scenario)};
  storage.setItem(SESSION_KEY, JSON.stringify(record));
  return record.savedAt;
}
