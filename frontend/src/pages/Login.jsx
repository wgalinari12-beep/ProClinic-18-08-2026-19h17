import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Sparkles, Loader2, Mail, Lock, User as UserIcon, ArrowRight } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatApiErrorDetail } from "@/lib/api";

const BG_LIGHT = "https://static.prod-images.emergentagent.com/jobs/105902f2-609a-42b3-bec6-f2df115da137/images/4331dbc8649fd3592a14843363c6e41a00045ee78ab342bb3d431be15cba5ac4.png";
const BG_DARK = "https://static.prod-images.emergentagent.com/jobs/105902f2-609a-42b3-bec6-f2df115da137/images/d91651128f35fbd4c6d93f13ed152a1a90005e541b97afb8dcad745edd5fcd7e.png";

export default function Login() {
  const { user, login, register } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login"); // login | register
  const [authMode, setAuthMode] = useState("email"); // email | cpf
  const [email, setEmail] = useState("admin@proclinic.com");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("admin123");
  const [name, setName] = useState("");
  const [role, setRole] = useState("recepcao");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
  }, [user, navigate, location]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await login({ email: authMode === "email" ? email : null, cpf: authMode === "cpf" ? cpf : null, password });
      else await register({ email, password, name, role });
      toast.success(mode === "login" ? "Bem-vindo(a) de volta" : "Conta criada");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/auth/callback";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      {/* Left hero */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${theme === "dark" ? BG_DARK : BG_LIGHT})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-background/30 via-background/10 to-background/60" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/20 ring-1 ring-primary/40 backdrop-blur-md flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-display text-xl font-semibold tracking-tight">ProClinic</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Luxury Edition</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-4xl xl:text-5xl font-semibold tracking-tight leading-[1.05] text-balance">
            Excelência em cada
            <br />
            <span className="text-primary">atendimento.</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
            Gestão inteligente para clínicas que buscam excelência. Centralize pacientes,
            agenda, prontuário eletrônico, atendimento clínico, automações, documentos
            digitais e inteligência artificial em uma plataforma moderna, segura e
            desenvolvida para elevar a experiência do profissional e do paciente.
          </p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex flex-col justify-center items-center px-6 sm:px-12 py-12 relative">
        <div className="w-full max-w-md animate-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" strokeWidth={1.5} />
            </div>
            <div className="font-display text-xl font-semibold tracking-tight">ProClinic</div>
          </div>

          <div className="mb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              {mode === "login" ? "Acesso" : "Criar conta"}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {mode === "login" ? "Bem-vindo(a) de volta" : "Comece em minutos"}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {mode === "login"
                ? "Acesse sua clínica com email e senha."
                : "Cadastre-se para experimentar a plataforma."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
            {mode === "register" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">Nome completo</Label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                    <Input
                      id="name" data-testid="register-name"
                      value={name} onChange={(e) => setName(e.target.value)}
                      required placeholder="Dra. Bella Castro"
                      className="pl-9 h-11 rounded-xl border-border bg-card"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role" className="text-xs uppercase tracking-wider text-muted-foreground">Perfil</Label>
                  <select
                    id="role" data-testid="register-role"
                    value={role} onChange={(e) => setRole(e.target.value)}
                    className="w-full h-11 rounded-xl border border-border bg-card px-3 text-sm"
                  >
                    <option value="admin">Administrador</option>
                    <option value="profissional">Profissional</option>
                    <option value="recepcao">Recepção</option>
                    <option value="financeiro">Financeiro</option>
                    <option value="marketing">Marketing</option>
                    <option value="paciente">Paciente</option>
                  </select>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              {mode === "login" && (
                <div className="flex items-center gap-2 mb-2">
                  <button type="button" data-testid="toggle-auth-email"
                    onClick={() => setAuthMode("email")}
                    className={`text-[11px] px-3 py-1 rounded-full transition-colors ${authMode === "email" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                    Email
                  </button>
                  <button type="button" data-testid="toggle-auth-cpf"
                    onClick={() => setAuthMode("cpf")}
                    className={`text-[11px] px-3 py-1 rounded-full transition-colors ${authMode === "cpf" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                    CPF
                  </button>
                </div>
              )}
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                {mode === "login" && authMode === "cpf" ? "CPF" : "Email"}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                {mode === "login" && authMode === "cpf" ? (
                  <Input
                    id="cpf" type="text" data-testid="login-cpf"
                    value={cpf} onChange={(e) => setCpf(e.target.value)}
                    required placeholder="000.000.000-00"
                    className="pl-9 h-11 rounded-xl border-border bg-card"
                  />
                ) : (
                  <Input
                    id="email" type="email" data-testid="login-email"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    required placeholder="voce@clinica.com"
                    className="pl-9 h-11 rounded-xl border-border bg-card"
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <Input
                  id="password" type="password" data-testid="login-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required placeholder="••••••••"
                  className="pl-9 h-11 rounded-xl border-border bg-card"
                />
              </div>
            </div>

            <Button
              type="submit" disabled={busy}
              data-testid="login-submit-btn"
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Entrar" : "Criar conta"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>ou continue com</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button" variant="outline"
            data-testid="google-login-btn"
            onClick={handleGoogle}
            className="w-full h-11 rounded-xl border-border bg-card font-medium"
          >
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            Entrar com Google
          </Button>

          <p className="mt-8 text-sm text-muted-foreground text-center">
            {mode === "login" ? "Ainda não tem uma conta?" : "Já é cliente?"}{" "}
            <button
              data-testid="toggle-auth-mode"
              type="button"
              onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
              className="text-primary hover:underline font-medium"
            >
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </p>

          <p className="mt-10 text-[11px] text-muted-foreground/70 text-center">
            Conta demo: <span className="font-mono">admin@proclinic.com / admin123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
