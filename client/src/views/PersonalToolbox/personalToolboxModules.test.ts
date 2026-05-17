// personalToolboxModules.test.ts — Unit tests for Personal Toolbox module registry integrity.

import { describe, expect, it } from 'vitest';

import { PERSONAL_TOOLBOX_MODULES } from './personalToolboxModules.ts';

describe('PERSONAL_TOOLBOX_MODULES', () => {
  it('contains unique module identifiers', () => {
    const moduleIds = PERSONAL_TOOLBOX_MODULES.map((moduleDefinition) => moduleDefinition.id);
    const uniqueModuleIds = new Set(moduleIds);

    expect(uniqueModuleIds.size).toBe(moduleIds.length);
  });

  it('includes the expected core modules', () => {
    const moduleIds = PERSONAL_TOOLBOX_MODULES.map((moduleDefinition) => moduleDefinition.id);

    expect(moduleIds).toEqual(
      expect.arrayContaining(['my-issues', 'dev-workspace', 'snow-hub', 'reports-hub']),
    );
  });
});

