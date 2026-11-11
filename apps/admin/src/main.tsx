import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@fontsource-variable/geist";
import App from "./app/App";
import { AppProviders } from "./app/providers";
import { PublicMenuPage } from "./features/catalog/PublicMenuPage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/menu/:token" element={<PublicMenuPage />} />
        <Route path="*" element={<AppProviders><App /></AppProviders>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
