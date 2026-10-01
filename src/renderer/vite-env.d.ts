/// <reference types="vite/client" />

// Analytics environment variables
interface ImportMetaEnv {
    readonly VITE_ANALYTICS_ENABLED?: string;
    readonly VITE_ANALYTICS_API_KEY?: string;
    readonly VITE_ANALYTICS_ENDPOINT?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// Monaco Editor worker imports for Vite bundling
declare module 'monaco-editor/editor/editor.worker.js?worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}

declare module 'monaco-editor/language/json/json.worker.js?worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}

declare module 'monaco-editor/language/css/css.worker.js?worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}

declare module 'monaco-editor/language/html/html.worker.js?worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}

declare module 'monaco-editor/language/typescript/ts.worker.js?worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}
