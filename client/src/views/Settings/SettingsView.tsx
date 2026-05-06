// SettingsView.tsx — Application configuration for proxy URLs, theme, and version checks.

import type { ChangeEventHandler, FormEventHandler } from 'react';
import { useEffect, useState } from 'react';

import { fetchProxyConfig, fetchProxyStatus, updateProxyConfig } from '@/services/proxyApi.ts';
import { useSettingsStore } from '@/store/settingsStore.ts';
import type { ProxyConfig, Theme } from '@/types/config.ts';
import styles from './SettingsView.module.css';

const SETTINGS_HEADING = 'Settings';
const SETTINGS_SUBHEADING = 'Manage service endpoints, visual theme, and desktop version details.';
const VERSION_UNAVAILABLE = 'Unavailable';
const EMPTY_STATUS_MESSAGE = '';
const SAVE_SUCCESS_MESSAGE = 'Saved.';
const SAVE_FAILURE_MESSAGE = 'Unable to save settings.';
const LOAD_FAILURE_MESSAGE = 'Unable to load proxy settings.';
const JIRA_SECTION_TITLE = 'Jira Connection';
const SNOW_SECTION_TITLE = 'ServiceNow Connection';
const CONFLUENCE_SECTION_TITLE = 'Confluence';
const APPEARANCE_SECTION_TITLE = 'Appearance';
const VERSION_SECTION_TITLE = 'Version';
const CHECK_FOR_UPDATES_LABEL = 'Check for updates';

type EditableProxyFieldKey = 'jiraBaseUrl' | 'snowBaseUrl' | 'confluenceBaseUrl';

interface SettingsInputCardProps {
  title: string;
  label: string;
  inputValue: string;
  handleChange: ChangeEventHandler<HTMLInputElement>;
  handleSubmit: FormEventHandler<HTMLFormElement>;
  handleBlur: () => void;
  saveStatusMessage: string;
}

interface ThemeCardProps {
  activeTheme: Theme;
  handleThemeSelection: (theme: Theme) => void;
}

interface VersionCardProps {
  proxyVersion: string;
  handleVersionRefresh: () => void;
}

interface ProxyConfigLoadHandlers {
  applyJiraBaseUrl: (value: string) => void;
  applySnowBaseUrl: (value: string) => void;
  applyConfluenceBaseUrl: (value: string) => void;
  setSaveStatusMessage: (message: string) => void;
}

interface ProxyFieldSaveOptions {
  fieldKey: EditableProxyFieldKey;
  fieldValue: string;
  persistValue: (value: string) => void;
  setSaveStatusMessage: (message: string) => void;
}

function SettingsInputCard({
  title,
  label,
  inputValue,
  handleChange,
  handleSubmit,
  handleBlur,
  saveStatusMessage,
}: SettingsInputCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{title}</h2>
      </div>
      <form className={styles.cardBody} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>{label}</span>
          <input className={styles.input} onBlur={handleBlur} onChange={handleChange} value={inputValue} />
        </label>
        <div className={styles.saveStatus}>{saveStatusMessage}</div>
      </form>
    </section>
  );
}

function ThemeCard({ activeTheme, handleThemeSelection }: ThemeCardProps) {
  const isDarkTheme = activeTheme === 'dark';
  const darkButtonClassName = isDarkTheme ? `${styles.themeBtn} ${styles.active}` : styles.themeBtn;
  const lightButtonClassName = isDarkTheme ? styles.themeBtn : `${styles.themeBtn} ${styles.active}`;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{APPEARANCE_SECTION_TITLE}</h2>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.themeToggle}>
          <button className={darkButtonClassName} onClick={() => handleThemeSelection('dark')} type="button">
            Dark
          </button>
          <button className={lightButtonClassName} onClick={() => handleThemeSelection('light')} type="button">
            Light
          </button>
        </div>
      </div>
    </section>
  );
}

function VersionCard({ proxyVersion, handleVersionRefresh }: VersionCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{VERSION_SECTION_TITLE}</h2>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.versionRow}>
          <span className={styles.versionText}>
            Proxy version: <span className={styles.versionValue}>{proxyVersion}</span>
          </span>
          <button className={styles.themeBtn} onClick={handleVersionRefresh} type="button">
            {CHECK_FOR_UPDATES_LABEL}
          </button>
        </div>
      </div>
    </section>
  );
}

function createProxyUpdatePayload(
  fieldKey: EditableProxyFieldKey,
  fieldValue: string,
): Partial<ProxyConfig> {
  return { [fieldKey]: fieldValue } as Partial<ProxyConfig>;
}

async function loadProxyConfiguration({
  applyJiraBaseUrl,
  applySnowBaseUrl,
  applyConfluenceBaseUrl,
  setSaveStatusMessage,
}: ProxyConfigLoadHandlers): Promise<void> {
  try {
    const proxyConfig = await fetchProxyConfig();
    applyJiraBaseUrl(proxyConfig.jiraBaseUrl);
    applySnowBaseUrl(proxyConfig.snowBaseUrl);
    applyConfluenceBaseUrl(proxyConfig.confluenceBaseUrl);
    setSaveStatusMessage(EMPTY_STATUS_MESSAGE);
  } catch {
    setSaveStatusMessage(LOAD_FAILURE_MESSAGE);
  }
}

async function refreshProxyVersion(setProxyVersion: (version: string) => void): Promise<void> {
  try {
    const proxyStatus = await fetchProxyStatus();
    setProxyVersion(proxyStatus.version);
  } catch {
    setProxyVersion(VERSION_UNAVAILABLE);
  }
}

async function saveProxyField({
  fieldKey,
  fieldValue,
  persistValue,
  setSaveStatusMessage,
}: ProxyFieldSaveOptions): Promise<void> {
  try {
    await updateProxyConfig(createProxyUpdatePayload(fieldKey, fieldValue));
    persistValue(fieldValue);
    setSaveStatusMessage(SAVE_SUCCESS_MESSAGE);
  } catch {
    setSaveStatusMessage(SAVE_FAILURE_MESSAGE);
  }
}

/** Renders the Settings view for service URL configuration, theme selection, and version checks. */
export default function SettingsView() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const storedJiraBaseUrl = useSettingsStore((state) => state.changeRequestGeneratorJiraUrl);
  const storedSnowBaseUrl = useSettingsStore((state) => state.changeRequestGeneratorSnowUrl);
  const storedConfluenceBaseUrl = useSettingsStore((state) => state.confluenceUrl);
  const setStoredJiraBaseUrl = useSettingsStore((state) => state.setChangeRequestGeneratorJiraUrl);
  const setStoredSnowBaseUrl = useSettingsStore((state) => state.setChangeRequestGeneratorSnowUrl);
  const setStoredConfluenceBaseUrl = useSettingsStore((state) => state.setConfluenceUrl);
  const [jiraBaseUrlInput, setJiraBaseUrlInput] = useState(storedJiraBaseUrl);
  const [snowBaseUrlInput, setSnowBaseUrlInput] = useState(storedSnowBaseUrl);
  const [confluenceBaseUrlInput, setConfluenceBaseUrlInput] = useState(storedConfluenceBaseUrl);
  const [saveStatusMessage, setSaveStatusMessage] = useState(EMPTY_STATUS_MESSAGE);
  const [proxyVersion, setProxyVersion] = useState(VERSION_UNAVAILABLE);

  useEffect(() => {
    void loadProxyConfiguration({
      applyJiraBaseUrl: (value) => {
        setJiraBaseUrlInput(value);
        setStoredJiraBaseUrl(value);
      },
      applySnowBaseUrl: (value) => {
        setSnowBaseUrlInput(value);
        setStoredSnowBaseUrl(value);
      },
      applyConfluenceBaseUrl: (value) => {
        setConfluenceBaseUrlInput(value);
        setStoredConfluenceBaseUrl(value);
      },
      setSaveStatusMessage,
    });
    void refreshProxyVersion(setProxyVersion);
  }, [setStoredConfluenceBaseUrl, setStoredJiraBaseUrl, setStoredSnowBaseUrl]);

  async function saveJiraBaseUrl(): Promise<void> {
    await saveProxyField({
      fieldKey: 'jiraBaseUrl',
      fieldValue: jiraBaseUrlInput,
      persistValue: setStoredJiraBaseUrl,
      setSaveStatusMessage,
    });
  }

  async function saveSnowBaseUrl(): Promise<void> {
    await saveProxyField({
      fieldKey: 'snowBaseUrl',
      fieldValue: snowBaseUrlInput,
      persistValue: setStoredSnowBaseUrl,
      setSaveStatusMessage,
    });
  }

  async function saveConfluenceBaseUrl(): Promise<void> {
    await saveProxyField({
      fieldKey: 'confluenceBaseUrl',
      fieldValue: confluenceBaseUrlInput,
      persistValue: setStoredConfluenceBaseUrl,
      setSaveStatusMessage,
    });
  }

  function handleThemeSelection(nextTheme: Theme): void {
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  }

  return (
    <div className={styles.settingsView}>
      <header>
        <h1 className={styles.cardTitle}>{SETTINGS_HEADING}</h1>
        <p className={styles.label}>{SETTINGS_SUBHEADING}</p>
      </header>
      <SettingsInputCard
        title={JIRA_SECTION_TITLE}
        label="Jira base URL"
        inputValue={jiraBaseUrlInput}
        handleChange={(event) => setJiraBaseUrlInput(event.target.value)}
        handleSubmit={(event) => {
          event.preventDefault();
          void saveJiraBaseUrl();
        }}
        handleBlur={() => {
          void saveJiraBaseUrl();
        }}
        saveStatusMessage={saveStatusMessage}
      />
      <SettingsInputCard
        title={SNOW_SECTION_TITLE}
        label="ServiceNow base URL"
        inputValue={snowBaseUrlInput}
        handleChange={(event) => setSnowBaseUrlInput(event.target.value)}
        handleSubmit={(event) => {
          event.preventDefault();
          void saveSnowBaseUrl();
        }}
        handleBlur={() => {
          void saveSnowBaseUrl();
        }}
        saveStatusMessage={saveStatusMessage}
      />
      <SettingsInputCard
        title={CONFLUENCE_SECTION_TITLE}
        label="Confluence base URL"
        inputValue={confluenceBaseUrlInput}
        handleChange={(event) => setConfluenceBaseUrlInput(event.target.value)}
        handleSubmit={(event) => {
          event.preventDefault();
          void saveConfluenceBaseUrl();
        }}
        handleBlur={() => {
          void saveConfluenceBaseUrl();
        }}
        saveStatusMessage={saveStatusMessage}
      />
      <ThemeCard activeTheme={theme} handleThemeSelection={handleThemeSelection} />
      <VersionCard handleVersionRefresh={() => void refreshProxyVersion(setProxyVersion)} proxyVersion={proxyVersion} />
    </div>
  );
}
