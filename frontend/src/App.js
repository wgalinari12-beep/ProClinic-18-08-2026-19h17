import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "@/App.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";

import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import PatientDetail from "@/pages/PatientDetail";
import Agenda from "@/pages/Agenda";
import Prontuario from "@/pages/Prontuario";
import Anamnese from "@/pages/Anamnese";
import Financeiro from "@/pages/Financeiro";
import AIAssistant from "@/pages/AIAssistant";
import Configuracoes from "@/pages/Configuracoes";
import Mensagens from "@/pages/Mensagens";
import Procedimentos from "@/pages/Procedimentos";
import MinhaClinica from "@/pages/MinhaClinica";
import ConfirmacaoPublica from "@/pages/ConfirmacaoPublica";
import MobileUpload from "@/pages/MobileUpload";
import Equipe from "@/pages/Equipe";
import ChangePasswordModal from "@/components/ChangePasswordModal";

function AppRouter() {
  const location = useLocation();
  // Synchronous detect: if return from Emergent OAuth → render AuthCallback
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/confirmacao/:token" element={<ConfirmacaoPublica />} />
      <Route path="/upload-mobile" element={<MobileUpload />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="pacientes" element={<Patients />} />
        <Route path="pacientes/:id" element={<PatientDetail />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="prontuario" element={<Prontuario />} />
        <Route path="anamnese" element={<Anamnese />} />
        <Route path="procedimentos" element={<Procedimentos />} />
        <Route path="financeiro" element={<Financeiro />} />
        <Route path="mensagens" element={<Mensagens />} />
        <Route path="assistente-ia" element={<AIAssistant />} />
        <Route path="minha-clinica" element={<MinhaClinica />} />
        <Route path="equipe" element={<Equipe />} />
        <Route path="configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <ChangePasswordModal />
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
