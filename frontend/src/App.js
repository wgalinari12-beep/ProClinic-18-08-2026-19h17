import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "@/App.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ClinicBrandProvider } from "@/contexts/ClinicBrandContext";
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
import OrcamentoPublico from "@/pages/OrcamentoPublico";
import DocumentoPublico from "@/pages/DocumentoPublico";
import DocumentoValidacao from "@/pages/DocumentoValidacao";
import Documentos from "@/pages/Documentos";
import DocumentosCategorias from "@/pages/DocumentosCategorias";
import DocumentosVariaveis from "@/pages/DocumentosVariaveis";
import DocumentosConfiguracoes from "@/pages/DocumentosConfiguracoes";
import Planos from "@/pages/Planos";
import Checkout from "@/pages/Checkout";
import MinhaAssinatura from "@/pages/MinhaAssinatura";
import SuperAdmin from "@/pages/SuperAdmin";
import Equipe from "@/pages/Equipe";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import { useAuth } from "@/contexts/AuthContext";

function DenyRoles({ deny = [], children }) {
  const { user } = useAuth();
  if (user && deny.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

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
      <Route path="/orcamento/:token" element={<OrcamentoPublico />} />
      <Route path="/documento-publico/:token" element={<DocumentoPublico />} />
      <Route path="/documento/:documentId/validar" element={<DocumentoValidacao />} />
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
        <Route path="prontuario" element={<DenyRoles deny={["recepcao"]}><Prontuario /></DenyRoles>} />
        <Route path="anamnese" element={<DenyRoles deny={["recepcao"]}><Anamnese /></DenyRoles>} />
        <Route path="procedimentos" element={<Procedimentos />} />
        <Route path="financeiro" element={<Financeiro />} />
        <Route path="mensagens" element={<Mensagens />} />
        <Route path="assistente-ia" element={<DenyRoles deny={["recepcao"]}><AIAssistant /></DenyRoles>} />
        <Route path="documentos" element={<DenyRoles deny={["recepcao"]}><Documentos /></DenyRoles>} />
        <Route path="documentos/categorias" element={<DenyRoles deny={["recepcao"]}><DocumentosCategorias /></DenyRoles>} />
        <Route path="documentos/variaveis" element={<DenyRoles deny={["recepcao"]}><DocumentosVariaveis /></DenyRoles>} />
        <Route path="documentos/configuracoes" element={<DenyRoles deny={["recepcao"]}><DocumentosConfiguracoes /></DenyRoles>} />
        <Route path="planos" element={<Planos />} />
        <Route path="checkout/:planKey" element={<Checkout />} />
        <Route path="minha-assinatura" element={<MinhaAssinatura />} />
        <Route path="super-admin" element={<ProtectedRoute roles={["super_admin"]}><SuperAdmin /></ProtectedRoute>} />
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
          <ClinicBrandProvider>
            <AppRouter />
            <ChangePasswordModal />
            <Toaster position="top-right" />
          </ClinicBrandProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
