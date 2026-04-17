type FileEntry = {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  downloadUrl: string;
  content: string | null;
  truncated: boolean;
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SkillFileViewer({ files }: { files: FileEntry[] }) {
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Files</h2>
      <div className="mt-3 divide-y">
        {files.map((file) => (
          <div key={file.sha256 + file.path} className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm">{file.path}</p>
                <p className="text-xs text-gray-400">
                  {file.contentType} · {humanSize(file.size)}
                </p>
              </div>
              <a href={file.downloadUrl} className="text-sm text-blue-600 hover:underline">
                Download
              </a>
            </div>
            {file.content !== null && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
                  View contents
                </summary>
                {file.truncated && (
                  <p className="mt-2 text-xs text-yellow-700">
                    File truncated — download for the full contents.
                  </p>
                )}
                <pre className="mt-2 max-h-[500px] overflow-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-800">
                  {file.content}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
