// configBackup.test.ts — Proves a settings backup carries the settings, refuses the secrets, and
// never changes anything without saying what it would change first.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_BACKUP_VERSION,
  applyConfigRestore,
  buildBackupFileName,
  buildConfigBackup,
  describeBackupProblem,
  describeRestorePlan,
  isBackupKey,
  planConfigRestore,
  type ConfigBackup,
} from './configBackup.ts';

/** A storage double, so the whole thing is testable without a browser. */
function buildStorage(seed: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(seed));
  return {
    get length() { return entries.size; },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (storageKey: string) => entries.get(storageKey) ?? null,
    setItem: (storageKey: string, value: string) => { entries.set(storageKey, value); },
    removeItem: (storageKey: string) => { entries.delete(storageKey); },
    clear: () => entries.clear(),
  } as Storage;
}

describe('isBackupKey', () => {
  it('carries the settings this app owns', () => {
    expect(isBackupKey('tbxBoardVocabulary')).toBe(true);
    expect(isBackupKey('ntbx-crg-templates')).toBe(true);
  });

  it('never carries the admin passphrase', () => {
    // A file somebody emails to a colleague must not contain it. This is the assertion that stops a
    // convenience feature becoming a credential leak.
    expect(isBackupKey('tbxAdminPassphrase')).toBe(false);
  });

  it('never carries the unlock flags', () => {
    // They say what THIS machine is currently allowed to do, not what the team configured. Carrying
    // them would hand an unlocked Admin Hub to whoever opened the file.
    expect(isBackupKey('tbxAdminUnlocked')).toBe(false);
    expect(isBackupKey('tbxAdvancedUnlocked')).toBe(false);
    expect(isBackupKey('tbxAiAssistUnlocked')).toBe(false);
  });

  it('leaves other applications storage alone', () => {
    expect(isBackupKey('some-other-app-token')).toBe(false);
  });
});

describe('buildConfigBackup', () => {
  it('collects every setting, and only settings', () => {
    const backup = buildConfigBackup(buildStorage({
      tbxBoardVocabulary: '{"columns":[]}',
      'ntbx-crg-templates': '[]',
      tbxAdminPassphrase: 'a secret',
      unrelated: 'x',
    }), '0.200.0', '2026-08-17T09:00:00.000Z');

    expect(Object.keys(backup.entries).sort()).toEqual(['ntbx-crg-templates', 'tbxBoardVocabulary']);
  });

  it('stamps the version and the app that wrote it', () => {
    // For when a restore behaves oddly a year from now and nobody remembers which build made the file.
    const backup = buildConfigBackup(buildStorage({ tbxA: '1' }), '0.200.0', '2026-08-17T09:00:00.000Z');

    expect(backup.version).toBe(CONFIG_BACKUP_VERSION);
    expect(backup.appVersion).toBe('0.200.0');
    expect(backup.exportedAt).toBe('2026-08-17T09:00:00.000Z');
  });
});

describe('describeBackupProblem', () => {
  it('accepts a backup this app wrote', () => {
    expect(describeBackupProblem({ version: 1, entries: {} })).toBeNull();
  });

  it('refuses a file that is not a backup at all', () => {
    expect(describeBackupProblem('just some text')).toContain('not a NodeToolbox settings backup');
    expect(describeBackupProblem({ hello: 'world' })).toContain('no backup version');
  });

  it('refuses a backup from a NEWER app rather than half-reading it', () => {
    // Reading a format this build does not know would restore some settings and silently drop others.
    expect(describeBackupProblem({ version: CONFIG_BACKUP_VERSION + 1, entries: {} }))
      .toContain('newer NodeToolbox');
  });

  it('refuses a backup with no settings in it', () => {
    expect(describeBackupProblem({ version: 1 })).toContain('no settings in it');
  });
});

describe('planConfigRestore', () => {
  const BACKUP: ConfigBackup = {
    version: 1,
    exportedAt: '2026-08-17T09:00:00.000Z',
    appVersion: '0.200.0',
    entries: { tbxKeep: 'same', tbxChange: 'new value', tbxNew: 'added' },
  };

  it('says what it would REPLACE before replacing anything', () => {
    // These settings represent months of agreement about columns, mappings and team shape. Nobody
    // should discover afterwards that they were overwritten.
    const changes = planConfigRestore(buildStorage({ tbxKeep: 'same', tbxChange: 'old value' }), BACKUP);

    expect(changes).toEqual([
      { storageKey: 'tbxChange', kind: 'replaced' },
      { storageKey: 'tbxKeep', kind: 'unchanged' },
      { storageKey: 'tbxNew', kind: 'added' },
    ]);
  });

  it('changes nothing while planning', () => {
    const storage = buildStorage({ tbxChange: 'old value' });

    planConfigRestore(storage, BACKUP);

    expect(storage.getItem('tbxChange')).toBe('old value');
  });

  it('summarises the plan, so the headline is not left to be counted off a list', () => {
    const changes = planConfigRestore(buildStorage({ tbxKeep: 'same', tbxChange: 'old value' }), BACKUP);

    expect(describeRestorePlan(changes)).toBe('1 setting would be REPLACED, 1 added, 1 already match.');
  });

  it('says plainly when a restore would do nothing at all', () => {
    const changes = planConfigRestore(buildStorage({ tbxKeep: 'same' }), {
      ...BACKUP, entries: { tbxKeep: 'same' },
    });

    expect(describeRestorePlan(changes)).toContain('Nothing would change');
  });
});

describe('applyConfigRestore', () => {
  let storage: Storage;
  beforeEach(() => { storage = buildStorage({ tbxExisting: 'old', tbxUntouched: 'keep me' }); });

  it('writes the backup settings', () => {
    applyConfigRestore(storage, {
      version: 1, exportedAt: '', appVersion: '', entries: { tbxExisting: 'new' },
    });

    expect(storage.getItem('tbxExisting')).toBe('new');
  });

  it('leaves settings the backup does not mention alone', () => {
    // A restore means "make these settings true", not "make this machine identical" — clearing what
    // a file simply predates would turn a restore into a silent loss.
    applyConfigRestore(storage, {
      version: 1, exportedAt: '', appVersion: '', entries: { tbxExisting: 'new' },
    });

    expect(storage.getItem('tbxUntouched')).toBe('keep me');
  });

  it('refuses to set anything outside this app, however the file was made', () => {
    // A settings file is not a licence to write arbitrary browser storage, and an edited or
    // hand-authored one must not become one.
    applyConfigRestore(storage, {
      version: 1,
      exportedAt: '',
      appVersion: '',
      entries: { 'some-other-app-token': 'stolen', tbxAdminPassphrase: 'a secret' },
    });

    expect(storage.getItem('some-other-app-token')).toBeNull();
    expect(storage.getItem('tbxAdminPassphrase')).toBeNull();
  });

  it('reports how many settings it wrote', () => {
    expect(applyConfigRestore(storage, {
      version: 1, exportedAt: '', appVersion: '', entries: { tbxOne: '1', tbxTwo: '2', bad: '3' },
    })).toBe(2);
  });
});

describe('buildBackupFileName', () => {
  it('dates the file, so a folder of them is readable at a glance', () => {
    expect(buildBackupFileName('2026-08-17T09:00:00.000Z')).toBe('nodetoolbox-settings-2026-08-17.json');
  });
});
