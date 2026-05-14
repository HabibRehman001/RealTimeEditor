import "../src/App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useRef, useMemo, useState, useEffect } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

const App = () => {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const ytext = useMemo(() => ydoc.getText("monaco"), [ydoc]);
  const editorRef = useRef(null);

  const [users, setUsers] = useState([]);
  const [userName, setUserName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("username") || "";
  });

  const handleMount = (editor) => {
    editorRef.current = editor;
    new MonacoBinding(
      ytext,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
    ); 
  };

  useEffect(() => {
    if (userName) {
      const provider = new SocketIOProvider(
        "/",
        "monaco",
        ydoc,

        { autoConnect: true },
      );
      provider.awareness.setLocalStateField("user", {
        name: userName,
        color: "#" + Math.floor(Math.random() * 16777215).toString(16),
      });

      const updateUsers = () => {
        const states = Array.from(provider.awareness.getStates().values());
        setUsers(
          states
            .filter((state) => state.user && state.user.name)
            .map((state) => state.user),
        );
      };

      updateUsers();
      provider.awareness.on("change", updateUsers);
      
      const beforeUnloadHandler = () => {
        provider.awareness.setLocalStateField("user", null);
      };
      window.addEventListener("beforeunload", beforeUnloadHandler);

      // new MonacoBinding(
      //   ytext,
      //   editor.getModel(),
      //   new Set([editorRef.current]),

      // );

      return () => {
        provider.awareness.off("change", updateUsers);
        provider.disconnect();
        window.removeEventListener("beforeunload", beforeUnloadHandler);
      };
    }
  }, [userName, ydoc]);

  const handleJoin = (e) => {
    e.preventDefault();
    setUserName(e.target.username.value);
    window.history.pushState({}, "", `?username=${e.target.username.value}`);
    
  };

  if (!userName) {
    return (
      <main className="h-screen w-screen bg-black flex gap-4 p-4 items-center justify-center">
        <form onSubmit={handleJoin} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Enter your name"
            className="p-2 rounded-lg bg-gray-800 text-white"
            name="username"
          />
          <button className="p-2 rounded-lg bg-blue-500 text-white">
            Join
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen bg-black flex gap-4 p-4">
      <aside className="h-full w-1/4 bg-white rounded-lg ">
        <h2 className="text-xl font-bold p-4 border-b">Active Users</h2>
        <ul className="p-4">
          {users.map((user, index) => (
            <li key={index} className="flex items-center gap-2 mb-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: user.color }}
              ></span>
              <span>{user.name}</span>
            </li>
          ))}
        </ul>
      </aside>
      <section className="h-full w-3/4 bg-gray-700 rounded-lg overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          defaultValue="// some comment"
          theme="vs-dark"
          onMount={handleMount}
        />
      </section>
    </main>
  );
};

export default App;
