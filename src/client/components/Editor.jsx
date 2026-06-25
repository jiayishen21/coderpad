import MonacoEditor from "@monaco-editor/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MonacoBinding } from "y-monaco";

export default function Editor({ language, provider, ydoc }) {
  const bindingRef = useRef(null);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const [editorSize, setEditorSize] = useState(getInitialEditorSize);

  function handleMount(editor, monaco) {
    const text = ydoc.getText("monaco");
    const model = editor.getModel();
    editorRef.current = editor;

    bindingRef.current = new MonacoBinding(
      text,
      model,
      new Set([editor]),
      provider.awareness,
    );

    monaco.editor.defineTheme("coderpad-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0f172a",
      },
    });
    monaco.editor.setTheme("coderpad-dark");
    measureEditor(containerRef.current, editor, setEditorSize);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const measure = () => measureEditor(container, editorRef.current, setEditorSize);
    const resizeObserver = new ResizeObserver(measure);
    const animationFrame = requestAnimationFrame(measure);

    resizeObserver.observe(container);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      editorRef.current = null;
    };
  }, []);

  return (
    <div className="editorPanel" ref={containerRef}>
      <MonacoEditor
        height={editorSize.height}
        language={language}
        onMount={handleMount}
        options={{
          automaticLayout: false,
          fontSize: 15,
          minimap: { enabled: false },
          padding: { top: 16 },
          scrollBeyondLastLine: false,
          wordWrap: "on",
        }}
        theme="coderpad-dark"
        width={editorSize.width}
      />
    </div>
  );
}

function getInitialEditorSize() {
  return {
    height: typeof window === "undefined" ? 600 : window.innerHeight,
    width: typeof window === "undefined" ? 960 : window.innerWidth,
  };
}

function measureEditor(container, editor, setEditorSize) {
  if (!container) {
    return;
  }

  const rect = container.getBoundingClientRect();
  const nextSize = {
    height: Math.max(240, Math.floor(window.innerHeight - rect.top)),
    width: Math.max(320, Math.floor(rect.width)),
  };

  setEditorSize((currentSize) => {
    if (currentSize.height === nextSize.height && currentSize.width === nextSize.width) {
      return currentSize;
    }

    return nextSize;
  });

  editor?.layout(nextSize);
}
