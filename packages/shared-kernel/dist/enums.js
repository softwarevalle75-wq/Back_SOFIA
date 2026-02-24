"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoConsentimiento = exports.RolMensaje = exports.DireccionMensaje = exports.EstadoSesionChat = exports.EstadoCita = exports.AreaDerecho = exports.EstadoCaso = exports.EstadoUsuario = exports.Rol = void 0;
// ─── Roles ─────────────────────────────────────────
var Rol;
(function (Rol) {
    Rol["ADMIN_CONSULTORIO"] = "ADMIN_CONSULTORIO";
    Rol["ESTUDIANTE"] = "ESTUDIANTE";
    Rol["USUARIO"] = "USUARIO";
})(Rol || (exports.Rol = Rol = {}));
// ─── Estado de usuario ─────────────────────────────
var EstadoUsuario;
(function (EstadoUsuario) {
    EstadoUsuario["ACTIVO"] = "ACTIVO";
    EstadoUsuario["INACTIVO"] = "INACTIVO";
    EstadoUsuario["SUSPENDIDO"] = "SUSPENDIDO";
})(EstadoUsuario || (exports.EstadoUsuario = EstadoUsuario = {}));
// ─── Estado de caso ────────────────────────────────
var EstadoCaso;
(function (EstadoCaso) {
    EstadoCaso["ABIERTO"] = "ABIERTO";
    EstadoCaso["EN_PROGRESO"] = "EN_PROGRESO";
    EstadoCaso["CERRADO"] = "CERRADO";
    EstadoCaso["DERIVADO"] = "DERIVADO";
})(EstadoCaso || (exports.EstadoCaso = EstadoCaso = {}));
// ─── Área de derecho ───────────────────────────────
var AreaDerecho;
(function (AreaDerecho) {
    AreaDerecho["CIVIL"] = "CIVIL";
    AreaDerecho["PENAL"] = "PENAL";
    AreaDerecho["LABORAL"] = "LABORAL";
    AreaDerecho["FAMILIA"] = "FAMILIA";
    AreaDerecho["ADMINISTRATIVO"] = "ADMINISTRATIVO";
    AreaDerecho["CONSTITUCIONAL"] = "CONSTITUCIONAL";
    AreaDerecho["COMERCIAL"] = "COMERCIAL";
    AreaDerecho["OTRO"] = "OTRO";
})(AreaDerecho || (exports.AreaDerecho = AreaDerecho = {}));
// ─── Estado de cita ────────────────────────────────
var EstadoCita;
(function (EstadoCita) {
    EstadoCita["PROGRAMADA"] = "PROGRAMADA";
    EstadoCita["CONFIRMADA"] = "CONFIRMADA";
    EstadoCita["EN_CURSO"] = "EN_CURSO";
    EstadoCita["COMPLETADA"] = "COMPLETADA";
    EstadoCita["CANCELADA"] = "CANCELADA";
    EstadoCita["NO_ASISTIO"] = "NO_ASISTIO";
})(EstadoCita || (exports.EstadoCita = EstadoCita = {}));
// ─── Sesión chat ───────────────────────────────────
var EstadoSesionChat;
(function (EstadoSesionChat) {
    EstadoSesionChat["ACTIVA"] = "ACTIVA";
    EstadoSesionChat["CERRADA"] = "CERRADA";
    EstadoSesionChat["EXPIRADA"] = "EXPIRADA";
})(EstadoSesionChat || (exports.EstadoSesionChat = EstadoSesionChat = {}));
// ─── Mensaje chat ──────────────────────────────────
var DireccionMensaje;
(function (DireccionMensaje) {
    DireccionMensaje["ENTRANTE"] = "ENTRANTE";
    DireccionMensaje["SALIENTE"] = "SALIENTE";
})(DireccionMensaje || (exports.DireccionMensaje = DireccionMensaje = {}));
var RolMensaje;
(function (RolMensaje) {
    RolMensaje["USUARIO"] = "USUARIO";
    RolMensaje["ASISTENTE"] = "ASISTENTE";
    RolMensaje["SISTEMA"] = "SISTEMA";
})(RolMensaje || (exports.RolMensaje = RolMensaje = {}));
// ─── Consentimiento ────────────────────────────────
var TipoConsentimiento;
(function (TipoConsentimiento) {
    TipoConsentimiento["TRATAMIENTO_DATOS"] = "TRATAMIENTO_DATOS";
    TipoConsentimiento["TERMINOS_SERVICIO"] = "TERMINOS_SERVICIO";
    TipoConsentimiento["POLITICA_PRIVACIDAD"] = "POLITICA_PRIVACIDAD";
})(TipoConsentimiento || (exports.TipoConsentimiento = TipoConsentimiento = {}));
//# sourceMappingURL=enums.js.map