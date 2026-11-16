import { useEffect, useRef, useState } from 'react';
import scanPin from '../../../vendor/sheetscan/pin.json';
import type { Project, Asset } from '../../lib/types';
import { addFiles, prepareImport, guessRole, type ImportItem } from '../../lib/project';
import { newProject, importProject } from '../../lib/storage';
import { Modal } from './Modal';
import type { DialogProps } from './types';

export function ImportDialog({
  project,
  locale,
  onClose,
  onError,
  onOpen,
  onAdd,
  initialFiles = [],
  feedback,
}: DialogProps & {
  project?: Project;
  onOpen: (p: Project, options?: { recognizePdf?: boolean }) => void;
  onAdd?: (base: Project, prepared: { project: Project; assets: Asset[] }) => Promise<void>;
  initialFiles?: File[];
}) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [name, setName] = useState(project?.name || ''),
    [items, setItems] = useState<ImportItem[]>(
      initialFiles.map((file) => ({ file, role: guessRole(file.name) })),
    ),
    [busy, setBusy] = useState(''),
    [status, setStatus] = useState(''),
    [saving, setSaving] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const add = (files: File[]) => {
    if (busy) return;
    setItems((prev) => [...prev, ...files.map((file) => ({ file, role: guessRole(file.name) }))]);
    setStatus('');
    if (!name && files[0]) setName(files[0].name.replace(/\.[^.]+$/, ''));
  };
  const hasScore =
      !!project?.score || !!project?.pdfSource || items.some((item) => item.role === 'score'),
    archiveOnly = items.length === 1 && /\.drippingproj$/i.test(items[0].file.name);
  const cancel = () => active.current?.abort(new DOMException('Import cancelled', 'AbortError'));
  const submit = async () => {
    const controller = new AbortController();
    active.current = controller;
    try {
      setStatus('');
      onError('');
      setBusy(t('创建项目…', 'Creating project…'));
      const archive = items.find((i) => /\.drippingproj$/i.test(i.file.name));
      if (archive) {
        if (items.length !== 1)
          throw Error(t('项目备份需单独打开', 'Open a project backup on its own'));
        onOpen(await importProject(archive.file));
        return;
      }
      if (!hasScore)
        throw Error(t('请先添加 PDF 或 MusicXML 乐谱', 'Add a PDF or MusicXML score first'));
      if ((project?.score || project?.pdfSource) && items.some((item) => item.role === 'score'))
        throw Error(t('请为另一份乐谱建立新项目', 'Create a new project for another score'));
      if (items.some((item) => item.file.size > 160 * 1024 * 1024))
        throw Error(t('单个文件请小于 160 MB', 'Keep each file below 160 MB'));
      controller.signal.throwIfAborted();
      const p = project || newProject(name.trim() || t('未命名练习', 'Untitled practice'));
      if (project && onAdd) {
        const prepared = await prepareImport(p, items, setBusy, { signal: controller.signal });
        controller.signal.throwIfAborted();
        setSaving(true);
        setBusy(t('保存素材…', 'Saving files…'));
        await onAdd(project, prepared);
        onClose();
      } else {
        const created = await addFiles(p, items, setBusy, { signal: controller.signal });
        onOpen(created, { recognizePdf: !!created.pdfSource });
      }
    } catch (error) {
      if (controller.signal.aborted)
        setStatus(
          t(
            '已取消。所选文件已保留，可以重试。',
            'Cancelled. Your selected files are retained; try again when ready.',
          ),
        );
      else onError(String(error));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
        setSaving(false);
      }
    }
  };
  return (
    <Modal
      closeDisabled={saving || (archiveOnly && !!busy)}
      feedback={feedback}
      title={project ? t('添加素材', 'Add files') : t('新的练习', 'A new practice')}
      onClose={() => {
        if (busy) {
          if (!archiveOnly && !saving) cancel();
        } else onClose();
      }}
    >
      {!project && (
        <label className="field">
          {t('项目名称', 'Project name')}
          <input
            disabled={!!busy}
            autoFocus
            data-dialog-autofocus
            value={name}
            placeholder={t('今天想练什么？', 'What are you playing today?')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <label
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add([...e.dataTransfer.files]);
        }}
      >
        <span className="drop-symbol">＋</span>
        <strong>{t('放入乐谱、伴奏和示范', 'Drop your score, backing and demo')}</strong>
        <span>PDF / MusicXML / MXL · WAV / MP3 / M4A / FLAC</span>
        <input
          disabled={!!busy}
          aria-label={t('选择素材', 'Choose files')}
          type="file"
          multiple
          accept=".pdf,.musicxml,.mxl,.xml,.drippingproj,audio/*"
          onChange={(e) => {
            add([...(e.target.files || [])]);
            e.target.value = '';
          }}
        />
      </label>
      <div className="import-list">
        {items.map((item, i) => (
          <div key={i}>
            <span title={item.file.name}>
              {item.file.name}
              <small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small>
            </span>
            {!/\.drippingproj$/i.test(item.file.name) && (
              <select
                disabled={!!busy || /\.pdf$/i.test(item.file.name)}
                aria-label={`${item.file.name} role`}
                value={item.role}
                onChange={(e) =>
                  setItems((rows) =>
                    rows.map((r, j) =>
                      i === j ? { ...r, role: e.target.value as ImportItem['role'] } : r,
                    ),
                  )
                }
              >
                <option value="score">{t('乐谱', 'Score')}</option>
                <option value="backing">{t('伴奏', 'Backing')}</option>
                <option value="demo">{t('示范录音', 'Demo recording')}</option>
              </select>
            )}
            <button
              disabled={!!busy}
              className="icon-button"
              aria-label={t('移除', 'Remove')}
              onClick={() => setItems((rows) => rows.filter((_, j) => i !== j))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!hasScore && !archiveOnly && (
        <p className="muted">
          {t(
            '先放入乐谱，练习与录音都跟随谱面的小节、拍与速度。',
            'Add a score first. Practice and recording follow its bars, beats and tempo.',
          )}
        </p>
      )}
      {items.some((item) => /\.pdf$/i.test(item.file.name)) && (
        <p className="muted">
          {t(
            '先保存项目与原 PDF，再在工作区后台识谱，不上传乐谱。',
            'Your project and original PDF are saved first. Recognition runs in the workspace without uploading the score.',
          )}{' '}
          <a href={scanPin.source} target="_blank" rel="noreferrer">
            {t('识谱源码与许可', 'Recognition source and license')}
          </a>
        </p>
      )}
      <p className="muted">
        {t(
          '素材保存在当前浏览器。也可以选择 .drippingproj 恢复完整项目。',
          'Files stay in this browser. Open a .drippingproj file to restore a project.',
        )}
      </p>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <footer>
        <span className="busy-text" role="status" aria-live="polite">
          {busy}
        </span>
        {busy && !archiveOnly && !saving && (
          <button onClick={cancel}>{t('取消导入', 'Cancel import')}</button>
        )}
        <button
          className="primary"
          disabled={!!busy || (!hasScore && !archiveOnly) || (!items.length && !!project)}
          onClick={submit}
        >
          {busy
            ? t('正在导入…', 'Importing…')
            : items.some((item) => /\.pdf$/i.test(item.file.name))
              ? t('创建项目', 'Create project')
              : t('开始练习', 'Start practicing')}
        </button>
      </footer>
    </Modal>
  );
}
