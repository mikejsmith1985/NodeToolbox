// PersonalToolboxView.tsx — User-configurable workspace that combines selected tools into one tabbed page.

import { useMemo, useState } from 'react';

import { PrimaryTabs } from '@/components/PrimaryTabs/PrimaryTabs.tsx';
import { useSettingsStore } from '@/store/settingsStore.ts';
import styles from './PersonalToolboxView.module.css';
import { PERSONAL_TOOLBOX_MODULES } from './personalToolboxModules.ts';

const VIEW_TITLE = 'Personal Toolbox';
const VIEW_SUBTITLE =
  'Build one workspace from the tools you use most. Keep only the modules you want and reorder them anytime.';
const BUILDER_TITLE = 'Build your toolbox';
const BUILDER_SUBTITLE =
  'Select modules to include, then set the display order for the personal workspace tab bar.';

function createDefaultModuleOrder(): string[] {
  return PERSONAL_TOOLBOX_MODULES.map((moduleDefinition) => moduleDefinition.id);
}

function getActiveModuleId(
  selectedModuleIds: readonly string[],
  requestedModuleId: string | null,
): string | null {
  if (selectedModuleIds.length === 0) {
    return null;
  }

  if (requestedModuleId && selectedModuleIds.includes(requestedModuleId)) {
    return requestedModuleId;
  }

  return selectedModuleIds[0];
}

function moveModulePosition(
  selectedModuleIds: readonly string[],
  moduleId: string,
  directionOffset: number,
): string[] {
  const currentIndex = selectedModuleIds.indexOf(moduleId);
  if (currentIndex < 0) {
    return [...selectedModuleIds];
  }

  const targetIndex = currentIndex + directionOffset;
  if (targetIndex < 0 || targetIndex >= selectedModuleIds.length) {
    return [...selectedModuleIds];
  }

  const reorderedModuleIds = [...selectedModuleIds];
  const [movedModuleId] = reorderedModuleIds.splice(currentIndex, 1);
  reorderedModuleIds.splice(targetIndex, 0, movedModuleId);
  return reorderedModuleIds;
}

/** Renders a customizable multi-tool workspace with user-selected modules in one tabbed surface. */
export default function PersonalToolboxView() {
  const storedModuleIds = useSettingsStore((state) => state.personalToolboxModuleIds);
  const setPersonalToolboxModuleIds = useSettingsStore((state) => state.setPersonalToolboxModuleIds);
  const [requestedActiveModuleId, setRequestedActiveModuleId] = useState<string | null>(null);

  const selectedModuleIds = storedModuleIds.length > 0 ? storedModuleIds : createDefaultModuleOrder();

  const selectedModules = useMemo(() => {
    const moduleById = new Map(
      PERSONAL_TOOLBOX_MODULES.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]),
    );
    return selectedModuleIds.flatMap((moduleId) => {
      const moduleDefinition = moduleById.get(moduleId);
      return moduleDefinition ? [moduleDefinition] : [];
    });
  }, [selectedModuleIds]);

  const activeModuleId = getActiveModuleId(selectedModuleIds, requestedActiveModuleId);

  function updateSelectedModuleIds(nextModuleIds: string[]): void {
    setPersonalToolboxModuleIds(nextModuleIds);
  }

  function handleModuleToggle(moduleId: string, shouldIncludeModule: boolean): void {
    if (shouldIncludeModule) {
      if (selectedModuleIds.includes(moduleId)) {
        return;
      }
      updateSelectedModuleIds([...selectedModuleIds, moduleId]);
      return;
    }

    updateSelectedModuleIds(selectedModuleIds.filter((existingModuleId) => existingModuleId !== moduleId));
  }

  function handleMoveModule(moduleId: string, directionOffset: number): void {
    updateSelectedModuleIds(moveModulePosition(selectedModuleIds, moduleId, directionOffset));
  }

  function handleResetToAllModules(): void {
    updateSelectedModuleIds(createDefaultModuleOrder());
  }

  return (
    <section className={styles.personalToolboxView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <section className={styles.builderPanel} aria-label={BUILDER_TITLE}>
        <div className={styles.builderHeader}>
          <h2 className={styles.builderTitle}>{BUILDER_TITLE}</h2>
          <p className={styles.builderSubtitle}>{BUILDER_SUBTITLE}</p>
        </div>
        <div className={styles.builderGrid}>
          <div className={styles.moduleSelectionColumn}>
            {PERSONAL_TOOLBOX_MODULES.map((moduleDefinition) => {
              const isSelected = selectedModuleIds.includes(moduleDefinition.id);
              return (
                <label key={moduleDefinition.id} className={styles.moduleToggle}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(changeEvent) =>
                      handleModuleToggle(moduleDefinition.id, changeEvent.target.checked)
                    }
                  />
                  <div className={styles.moduleToggleContent}>
                    <span className={styles.moduleTitle}>{moduleDefinition.title}</span>
                    <span className={styles.moduleDescription}>{moduleDefinition.description}</span>
                  </div>
                </label>
              );
            })}
          </div>
          <div className={styles.moduleOrderColumn}>
            <h3 className={styles.orderTitle}>Tab order</h3>
            {selectedModules.length === 0 ? (
              <p className={styles.emptyState}>Select at least one module to build your personal toolbox.</p>
            ) : (
              <ol className={styles.orderList}>
                {selectedModules.map((moduleDefinition, moduleIndex) => (
                  <li key={moduleDefinition.id} className={styles.orderItem}>
                    <span>{moduleDefinition.title}</span>
                    <div className={styles.orderActions}>
                      <button
                        type="button"
                        className={styles.orderButton}
                        onClick={() => handleMoveModule(moduleDefinition.id, -1)}
                        disabled={moduleIndex === 0}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={styles.orderButton}
                        onClick={() => handleMoveModule(moduleDefinition.id, 1)}
                        disabled={moduleIndex === selectedModules.length - 1}
                      >
                        Move down
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className={styles.resetButton} onClick={handleResetToAllModules}>
              Reset to all modules
            </button>
          </div>
        </div>
      </section>

      {selectedModules.length > 0 && activeModuleId ? (
        <>
          <PrimaryTabs
            tabs={selectedModules.map((moduleDefinition) => ({
              key: moduleDefinition.id,
              label: moduleDefinition.title,
            }))}
            activeTab={activeModuleId}
            onChange={(moduleId) => setRequestedActiveModuleId(moduleId)}
            ariaLabel="Personal toolbox modules"
            idPrefix="personal-toolbox"
          />
          {selectedModules.map((moduleDefinition) => {
            const ModuleComponent = moduleDefinition.component;
            return (
              <section
                key={moduleDefinition.id}
                id={`personal-toolbox-${moduleDefinition.id}-panel`}
                role="tabpanel"
                aria-labelledby={`personal-toolbox-${moduleDefinition.id}-tab`}
                hidden={activeModuleId !== moduleDefinition.id}
              >
                <ModuleComponent />
              </section>
            );
          })}
        </>
      ) : (
        <p className={styles.emptyState}>No modules selected. Enable modules above to build your toolbox.</p>
      )}
    </section>
  );
}

