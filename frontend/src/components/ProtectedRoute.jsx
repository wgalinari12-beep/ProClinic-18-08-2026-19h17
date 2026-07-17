import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="auth-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  // super_admin lives in its own dashboard
  if (user.role === "super_admin" && ["/dashboard", "/pacientes", "/agenda", "/prontuario", "/anamnese", "/documentos", "/procedimentos", "/mensagens", "/assistente-ia", "/financeiro", "/equipe", "/minha-clinica", "/minha-assinatura", "/planos"].some((p) => location.pathname.startsWith(p))) {
    return <Navigate to="/super-admin" replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}
