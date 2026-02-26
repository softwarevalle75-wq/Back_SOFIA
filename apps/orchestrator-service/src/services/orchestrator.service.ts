import { createLogger } from '@sofia/observability';
import { randomUUID } from 'crypto';
import { classifyExtract, type AIResult } from '../clients/aiServiceClient';
import { askRag, type RagAnswerResult } from '../clients/ragClient';
import { conversationClient } from '../clients/conversation.client';
import { env } from '../config';
import { ConversationStore, type ConversationState } from './conversationStore';
import {
  ConversationChannel,
  ConversationMessageType,
  MessageIn,
  MessageOut,
  OrchestratorResponse,
} from '../dtos';

const log = createLogger('orchestrator-service-logic');
const conversationStore = new ConversationStore(env.ORCH_CONV_TTL_MIN * 60_000);

type Intent = 'general' | 'consulta_laboral' | 'consulta_juridica' | 'soporte';
type Step =
  | 'ask_intent'
  | 'ask_city'
  | 'ask_age'
  | 'collecting_issue'
  | 'ready_for_handoff'
  | 'ask_issue'
  | 'offer_appointment'
  | 'ask_user_full_name'
  | 'ask_user_doc_type'
  | 'ask_user_doc_number'
  | 'ask_user_email'
  | 'ask_user_phone_confirm'
  | 'ask_user_phone'
  | 'ask_appointment_mode'
  | 'ask_appointment_day'
  | 'ask_appointment_time'
  | 'confirm_appointment';

interface OrchestratorContext {
  intent?: Intent;
  step?: Step;
  profile?: Record<string, unknown>;
}

interface Decision {
  patch: Record<string, unknown>;
  responseText: string;
  nextIntent: Intent;
  nextStep: Step;
}

const RAG_NEEDS_CONTEXT_FALLBACK =
  'Para ayudarte mejor, necesito un poco más de contexto. Cuéntame el tipo de caso, ciudad/país y qué ocurrió exactamente.';

const RAG_NO_CONTENT_FALLBACK =
  'Puedo orientarte de forma preliminar con la información del Consultorio. Para darte una respuesta útil ahora, comparte un dato clave del caso (por ejemplo: contrato/fecha en laboral, relación y situación en familia, o hecho principal en penal).';

const APPOINTMENT_OFFER_TEXT =
  'Si quieres, también te puedo ayudar a agendar una cita con un asesor. Puedes responder: "si, deseo agendar una cita" o "no, gracias".';

const APPOINTMENT_MODE_TEXT =
  'Perfecto, vamos con eso. ¿Prefieres que la cita sea presencial o virtual?';

const APPOINTMENT_USER_DATA_START_TEXT =
  'Perfecto, antes de agendar la cita te pido unos datos rápidos. Empecemos con tu nombre completo.';

const APPOINTMENT_DOC_TYPE_TEXT =
  'Gracias. Ahora cuéntame tu tipo de documento (CC, CE, TI, PASAPORTE o PPT).';

const DATA_POLICY_TEXT =
  '¡Hola! 👋 Qué gusto saludarte. Antes de comenzar, ¿me autorizas a tratar tus datos personales según nuestra política de privacidad?';

const TELEGRAM_DATA_POLICY_TEXT =
  '¡Hola! 👋 Soy Sofia, tu asistente virtual del Consultorio Jurídico. Antes de comenzar, ¿me autorizas a tratar tus datos personales según nuestra política de privacidad?';

const DATA_POLICY_REJECTED_TEXT =
  'Gracias por responder. Sin esa autorización no puedo continuar por este medio. Si más adelante quieres continuar, escribe reset. ¡Aquí estaré!';

const FOLLOWUP_HINT_TEXT =
  '¿Qué deseas hacer ahora?\n↩️ Para realizar otra consulta, escribe: *reset*\n📅 Para agendar una cita, escribe: *si, deseo agendar una cita*\nSi ya tienes una cita, puedes escribir:\n• *reprogramar cita*\n• *cancelar cita*\n🚪 Para finalizar la conversación, escribe: *salir*';

const GOODBYE_TEXT =
  '¡Con mucho gusto! Me alegra haberte ayudado. Cuando quieras volver, escribe reset. ¡Que estés muy bien!';

const SURVEY_RATING_TEXT =
  '🌟 Antes de cerrar, ¿cómo calificarías la atención del chatbot?\n\nResponde con una calificación del 1 al 5 (estrellas), donde 5 es excelente.';

const SURVEY_COMMENT_TEXT =
  '¡Gracias por tu calificación! Si deseas, compárteme un comentario sobre tu experiencia.\n\nSi no quieres comentar, escribe: omitir';

const SURVEY_THANKS_TEXT =
  '🙏 ¡Gracias por tu retroalimentación! Nos ayuda a mejorar el servicio.';

const RAG_ERROR_FALLBACK =
  'En este momento no pude consultar la base jurídica. Por favor cuéntame más contexto y lo intento de nuevo.';

const PRELIMINARY_GUIDANCE_DISCLAIMER =
  'Recuerda: esta orientación es preliminar y no reemplaza la atención presencial del Consultorio Jurídico.';

const ORIENTATION_DETAIL_PROMPT =
  'Si deseas una orientación más específica, puedes enviarme información adicional en texto como:\n📅 Fechas importantes\n🧾 Qué ocurrió exactamente\n👥 Quiénes están involucrados\n🎯 Qué resultado esperas\n\nEntre más detalles me compartas, mejor podré orientarte.';

const MENU_TEXT = `👋 ¡Bienvenido/a!\n\nSoy SOF-IA 🤖, tu asistente virtual del Consultorio Jurídico.\n\nPuedo orientarte de manera preliminar en temas como:\n\n⚖️ Laboral\n⚖️ Penal\n⚖️ Civil\n⚖️ Familia-alimentos\n⚖️ Constitucional\n⚖️ Administrativo\n⚖️ Conciliación\n⚖️ Tránsito\n⚖️ Disciplinario\n⚖️ Responsabilidad fiscal\n⚖️ Comercial\n\nCuéntame con tranquilidad tu caso o tu duda, y te acompañaré paso a paso 🤝`;

function getDataPolicyText(channel: MessageIn['channel']): string {
  if (channel === 'telegram') return TELEGRAM_DATA_POLICY_TEXT;
  return DATA_POLICY_TEXT;
}

function mapChannel(channel: MessageIn['channel']): ConversationChannel {
  if (channel === 'telegram' || channel === 'whatsapp') return 'WHATSAPP';
  return 'WEBCHAT';
}

function mapMessageType(type: MessageIn['message']['type']): ConversationMessageType {
  const map: Record<MessageIn['message']['type'], ConversationMessageType> = {
    text: 'TEXT',
    image: 'IMAGE',
    audio: 'AUDIO',
    document: 'DOCUMENT',
    interactive: 'INTERACTIVE',
  };
  return map[type];
}

function normalizeText(text?: string): string {
  return (text ?? '').trim().toLowerCase();
}

function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractRawText(input: unknown): string {
  const data = input as {
    text?: unknown;
    message?: unknown;
  };

  const asObj = typeof data?.message === 'object' && data.message !== null
    ? (data.message as { message?: unknown; text?: unknown; body?: unknown })
    : undefined;

  const fromNestedTextObject = typeof asObj?.text === 'object' && asObj.text !== null
    ? pickString((asObj.text as { body?: unknown }).body)
    : undefined;

  const extracted = pickString(data?.text)
    ?? (typeof data?.message === 'string' ? pickString(data.message) : undefined)
    ?? pickString(asObj?.message)
    ?? pickString(asObj?.text)
    ?? pickString(asObj?.body)
    ?? fromNestedTextObject
    ?? '';

  return extracted;
}

function extractText(input: unknown): string {
  return normalizeText(extractRawText(input));
}

function parseAge(text: string): number | undefined {
  const match = text.match(/\d{1,3}/);
  if (!match) return undefined;

  const age = Number.parseInt(match[0], 10);
  if (!Number.isFinite(age) || age <= 0 || age > 120) return undefined;
  return age;
}

function parseContext(raw: Record<string, unknown>): OrchestratorContext {
  return {
    intent: typeof raw.intent === 'string' ? (raw.intent as Intent) : undefined,
    step: typeof raw.step === 'string' ? (raw.step as Step) : undefined,
    profile: typeof raw.profile === 'object' && raw.profile !== null
      ? (raw.profile as Record<string, unknown>)
      : undefined,
  };
}

function normalizeIntent(intent: string | undefined): Intent {
  if (intent === 'consulta_juridica') return 'consulta_laboral';
  if (intent === 'consulta_laboral' || intent === 'soporte' || intent === 'general') return intent;
  return 'general';
}

function buildConversationKey(input: MessageIn): string {
  return `${input.tenantId}:${input.channel}:${input.externalUserId}`;
}

function isResetCommand(text: string): boolean {
  return ['reset', 'reiniciar', 'menu', 'menú', 'inicio', 'empezar'].includes(text);
}

function isConversationEndCommand(text: string): boolean {
  return [
    'salir',
    'terminar',
    'finalizar',
    'fin',
    'adios',
    'adiós',
    'chao',
    'hasta luego',
    'hasta pronto',
    'bye',
  ].includes(text);
}

function isNoMoreDoubtsMessage(text: string): boolean {
  return [
    'gracias',
    'muchas gracias',
    'listo gracias',
    'listo muchas gracias',
    'eso es todo',
    'todo claro',
    'no tengo mas dudas',
    'no tengo más dudas',
    'ninguna duda',
  ].includes(text);
}

function isAnotherQuestionPrompt(text: string): boolean {
  return text.includes('otra duda') || text.includes('otra consulta');
}

function isPolicyAccepted(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const hasNegativeSignal = [
    'no',
    'no acepto',
    'no autorizo',
    'rechazo',
    'negativo',
    'prefiero no',
    'no gracias',
  ].some((phrase) => normalized.includes(phrase));

  if (hasNegativeSignal) return false;

  return [
    'si',
    'acepto',
    'autorizo',
    'de acuerdo',
    'ok',
    'okay',
    'claro',
    'seguro',
    'vale',
    'listo',
    'dale',
    'afirmativo',
    'correcto',
    'perfecto',
  ].some((phrase) => normalized.includes(phrase));
}

function isPolicyRejected(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'nope',
    'no acepto',
    'no autorizo',
    'rechazo',
    'no',
    'negativo',
    'cancelar',
    'prefiero no',
    'no gracias',
  ].includes(normalized);
}

function isPositiveReply(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const hasNegativeSignal = [
    'no',
    'negativo',
    'no gracias',
    'para nada',
  ].some((phrase) => normalized.includes(phrase));

  if (hasNegativeSignal) return false;

  return [
    'si',
    's',
    'claro',
    'de acuerdo',
    'ok',
    'okay',
    'dale',
    'de una',
    'afirmativo',
    'correcto',
    'perfecto',
    'hagamoslo',
    'hágamoslo',
  ].some((phrase) => normalized.includes(phrase));
}

function isNegativeReply(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'no',
    'no gracias',
    'por ahora no',
    'ahora no',
  ].includes(normalized);
}

function isScheduleAppointmentRequest(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('agendar') && normalized.includes('cita');
}

function pickAppointmentMode(text: string): 'virtual' | 'presencial' | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized.includes('virtual')) return 'virtual';
  if (normalized.includes('presencial')) return 'presencial';
  return undefined;
}

function pickWeekday(text: string): 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized.includes('lunes')) return 'lunes';
  if (normalized.includes('martes')) return 'martes';
  if (normalized.includes('miercoles')) return 'miercoles';
  if (normalized.includes('jueves')) return 'jueves';
  if (normalized.includes('viernes')) return 'viernes';
  return undefined;
}

function hasWeekendMention(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('sabado') || normalized.includes('domingo');
}

function pickHour24(text: string): number | undefined {
  const normalized = normalizeForMatch(text);
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return undefined;

  const rawHour = Number.parseInt(match[1], 10);
  if (!Number.isFinite(rawHour)) return undefined;

  const suffix = match[3];
  const hasMorning = normalized.includes('manana');
  const hasAfternoon = normalized.includes('tarde');

  let hour = rawHour;
  if (suffix === 'am') {
    if (hour === 12) hour = 0;
  } else if (suffix === 'pm') {
    if (hour < 12) hour += 12;
  } else if (hasMorning) {
    if (hour === 12) hour = 0;
  } else if (hasAfternoon) {
    if (hour < 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return undefined;
  return hour;
}

function isHourAllowedByMode(mode: 'virtual' | 'presencial', hour24: number): boolean {
  const allowed = mode === 'virtual'
    ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    : [13, 14, 15, 16, 17];
  return allowed.includes(hour24);
}

function formatHour(hour24: number): string {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const raw = hour24 % 12;
  const hour12 = raw === 0 ? 12 : raw;
  return `${hour12}:00 ${suffix}`;
}

function appointmentHourHint(mode: 'virtual' | 'presencial'): string {
  if (mode === 'virtual') return 'Horario virtual disponible: 8:00, 9:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00 y 17:00.';
  return 'Horario presencial disponible: 13:00, 14:00, 15:00, 16:00 y 17:00.';
}

function buildAvailableHoursText(mode: 'virtual' | 'presencial', hours24: number[]): string {
  if (hours24.length === 0) {
    return `No hay horas disponibles para ${mode} ese día.`;
  }
  const formatted = hours24
    .slice()
    .sort((a, b) => a - b)
    .map((hour) => formatHour(hour))
    .join(', ');
  return `Horas disponibles para ${mode}: ${formatted}.`;
}

function formatWeekday(day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes'): string {
  if (day === 'miercoles') return 'miércoles';
  return day;
}

function isAppointmentConfirmCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized === 'confirmar cita'
    || normalized === 'confirmar'
    || normalized === 'confirmo'
    || normalized === 'sin cambios'
    || normalized === 'no cambios'
    || normalized === 'esta bien'
    || normalized === 'está bien';
}

function pickSurveyRating(text: string): number | undefined {
  const normalized = normalizeForMatch(text);
  const direct = normalized.match(/\b([1-5])\b/);
  if (direct) return Number.parseInt(direct[1], 10);

  const starsOnly = normalized.replace(/[^⭐★*]/g, '');
  if (starsOnly.length >= 1 && starsOnly.length <= 5) return starsOnly.length;

  if (normalized.includes('una estrella')) return 1;
  if (normalized.includes('dos estrellas')) return 2;
  if (normalized.includes('tres estrellas')) return 3;
  if (normalized.includes('cuatro estrellas')) return 4;
  if (normalized.includes('cinco estrellas')) return 5;

  return undefined;
}

function isSurveySkipComment(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized === 'omitir'
    || normalized === 'sin comentario'
    || normalized === 'no'
    || normalized === 'ninguno';
}

async function persistSurveyInAuthService(input: {
  rating: number;
  comment: string | null;
  correlationId: string;
}): Promise<void> {
  try {
    const response = await fetch(`${env.AUTH_SERVICE_URL}/api/encuestas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': input.correlationId,
      },
      body: JSON.stringify({
        calificacion: input.rating,
        comentario: input.comment,
        fuente: 'chatbot',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.warn({ status: response.status, body, correlationId: input.correlationId }, 'Failed to persist chatbot survey in auth-service');
    }
  } catch (error) {
    log.warn({ correlationId: input.correlationId, error: error instanceof Error ? error.message : String(error) }, 'Could not persist chatbot survey in auth-service');
  }
}

function isAppointmentCancelCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const mentionsCancel = normalized.includes('cancelar');
  const mentionsAppointment = normalized.includes('cita');

  if (mentionsCancel && mentionsAppointment) return true;

  return normalized === 'cancelar cita'
    || normalized === 'cancelar'
    || normalized === 'cancelar una cita'
    || normalized.includes('quiero cancelar la cita')
    || normalized.includes('quiero cancelar una cita')
    || normalized.includes('deseo cancelar una cita')
    || normalized.includes('deseo cancelar la cita');
}

function isAppointmentRescheduleCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const mentionsReschedule = normalized.includes('reprogram') || normalized.includes('reprogr');
  const mentionsAppointment = normalized.includes('cita');

  if (mentionsReschedule && mentionsAppointment) return true;

  return normalized === 'reprogramar cita'
    || normalized === 'reprograr cita'
    || normalized === 'reprogramar'
    || normalized === 'reprograr'
    || normalized.includes('reprograr una cita')
    || normalized.includes('quiero reprograr una cita')
    || normalized.includes('quiero reprogramar una cita')
    || normalized.includes('deseo reprogramar una cita')
    || normalized.includes('quiero reprogramar cita')
    || normalized.includes('deseo reprogramar cita')
    || normalized.includes('cambiar cita')
    || normalized.includes('quiero reprogramar la cita')
    || normalized.includes('deseo reprogramar la cita');
}

function isAppointmentChangeModeCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar modalidad') || normalized === 'modalidad';
}

function isAppointmentChangeDayCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar dia') || normalized === 'dia';
}

function isAppointmentChangeHourCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar hora') || normalized === 'hora';
}

function isAppointmentAvailabilityQuestion(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('horas disponibles')
    || normalized.includes('horarios disponibles')
    || normalized.includes('que horas hay')
    || normalized.includes('qué horas hay')
    || normalized.includes('que horas quedan')
    || normalized.includes('qué horas quedan')
    || normalized.includes('cuales horas')
    || normalized.includes('cuáles horas')
    || normalized.includes('disponibilidad');
}

function isAppointmentChangeFullNameCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar nombre') || normalized === 'nombre';
}

function isAppointmentChangeDocTypeCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar tipo de documento')
    || normalized.includes('cambiar tipo documento')
    || normalized === 'tipo de documento'
    || normalized === 'tipo documento';
}

function isAppointmentChangeDocNumberCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar numero de documento')
    || normalized.includes('cambiar número de documento')
    || normalized.includes('cambiar documento')
    || normalized === 'numero de documento'
    || normalized === 'número de documento'
    || normalized === 'documento';
}

function isAppointmentChangeEmailCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar correo') || normalized.includes('cambiar email') || normalized === 'correo' || normalized === 'email';
}

function isAppointmentChangePhoneCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar numero')
    || normalized.includes('cambiar número')
    || normalized.includes('cambiar telefono')
    || normalized.includes('cambiar teléfono')
    || normalized === 'numero'
    || normalized === 'número'
    || normalized === 'telefono'
    || normalized === 'teléfono';
}

type DocumentType = 'CC' | 'CE' | 'TI' | 'PASAPORTE' | 'PPT';

function pickDocumentType(text: string): DocumentType | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized === 'cc' || normalized.includes('cedula de ciudadania') || normalized.includes('cedula ciudadania')) {
    return 'CC';
  }
  if (normalized === 'ce' || normalized.includes('cedula de extranjeria') || normalized.includes('cedula extranjeria')) {
    return 'CE';
  }
  if (normalized === 'ti' || normalized.includes('tarjeta de identidad')) {
    return 'TI';
  }
  if (normalized.includes('pasaporte')) {
    return 'PASAPORTE';
  }
  if (normalized === 'ppt' || normalized.includes('permiso por proteccion temporal') || normalized.includes('permiso por proteccion')) {
    return 'PPT';
  }
  return undefined;
}

function pickDocumentNumber(text: string): string | undefined {
  const compact = text.trim().replace(/\s+/g, '');
  if (!/^[a-zA-Z0-9.-]{5,20}$/.test(compact)) return undefined;
  return compact;
}

function pickEmail(text: string): string | undefined {
  const value = text.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined;
  return value;
}

function pickPhone(text: string): string | undefined {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return digits;
}

function pickPhoneFromExternalUserId(externalUserId: string): string | undefined {
  const digits = externalUserId.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return digits;
}

function pickFullName(text: string): string | undefined {
  const value = text.trim().replace(/\s{2,}/g, ' ');
  if (value.length < 6) return undefined;
  const words = value.split(' ');
  if (words.length < 2) return undefined;
  return value;
}

type AppointmentUserData = {
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  email: string;
  phone: string;
};

type AppointmentScheduleData = {
  mode: 'virtual' | 'presencial';
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  hour24: number;
};

type LaboralCompetenceAssessment = {
  status: 'competent' | 'not_competent' | 'unknown';
  reason?: string;
};

function pickAppointmentUserData(profile: Record<string, unknown>): AppointmentUserData | undefined {
  const userData = typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null
    ? (profile.appointmentUser as Record<string, unknown>)
    : undefined;
  if (!userData) return undefined;

  const fullName = typeof userData.fullName === 'string' ? userData.fullName : undefined;
  const documentType = typeof userData.documentType === 'string' ? userData.documentType as DocumentType : undefined;
  const documentNumber = typeof userData.documentNumber === 'string' ? userData.documentNumber : undefined;
  const email = typeof userData.email === 'string' ? userData.email : undefined;
  const phone = typeof userData.phone === 'string' ? userData.phone : undefined;

  if (!fullName || !documentType || !documentNumber || !email || !phone) return undefined;
  return { fullName, documentType, documentNumber, email, phone };
}

function pickAppointmentScheduleData(profile: Record<string, unknown>): AppointmentScheduleData | undefined {
  const appointment = (typeof profile.appointment === 'object' && profile.appointment !== null)
    ? (profile.appointment as Record<string, unknown>)
    : undefined;
  if (!appointment) return undefined;

  const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
    ? appointment.mode
    : undefined;
  const day = pickWeekday(String(appointment.day ?? ''));
  const hour24 = typeof appointment.hour24 === 'number' ? appointment.hour24 : undefined;

  if (!mode || !day || hour24 === undefined || !isHourAllowedByMode(mode, hour24)) return undefined;
  return { mode, day, hour24 };
}

function shouldReturnToConfirm(profile: Record<string, unknown>): boolean {
  return profile.appointmentReturnToConfirm === true;
}

function clearReturnToConfirmFlag(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    ...profile,
    appointmentReturnToConfirm: undefined,
  };
}

function buildAppointmentConfirmationText(userData: AppointmentUserData, schedule: AppointmentScheduleData): string {
  return `📝 Confirmación de tu cita\n\nPor favor, revisa que tus datos estén correctos:\n\n👤 Nombre completo: ${userData.fullName}\n🪪 Tipo de documento: ${userData.documentType}\n🔢 Número de documento: ${userData.documentNumber}\n📧 Correo electrónico: ${userData.email}\n📱 Número de contacto: ${userData.phone}\n📍 Modalidad: ${schedule.mode}\n📅 Día: ${formatWeekday(schedule.day)}\n⏰ Hora: ${formatHour(schedule.hour24)}\n\nSi necesitas modificar algún dato, escribe por ejemplo:\n• cambiar nombre\n• cambiar tipo de documento\n• cambiar número de documento\n• cambiar correo\n• cambiar número\n• cambiar modalidad\n• cambiar día\n• cambiar hora\n\nSi todo está correcto, escribe: ✅ confirmar cita`;
}

function buildAppointmentScheduledFriendlyText(schedule: AppointmentScheduleData): string {
  const modeLabel = schedule.mode === 'presencial' ? 'presencial' : 'virtual';

  return `✨ *¡Tu cita está confirmada!*

📅 *${formatWeekday(schedule.day)}*
⏰ *${formatHour(schedule.hour24)}*
📍 *Modalidad ${modeLabel}*

¡Te esperamos! 🙌

Si quieres hacer otra consulta, escribe *reset*.
Si deseas agendar una nueva cita, escribe *si, deseo agendar una cita*.
Si ya tienes una cita, también puedes reprogramarla o cancelarla escribiendo:
👉 *reprogramar cita*
👉 *cancelar cita*

Y si prefieres terminar la conversación, escribe *salir*.`;
}

type StoredAppointment = AppointmentScheduleData & {
  status: 'agendada' | 'cancelada';
  updatedAt: string;
  citaId?: string;
  assignedStudentName?: string;
  assignedStudentEmail?: string;
  user?: Record<string, unknown>;
};

function toStoredAppointment(value: unknown): StoredAppointment | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const data = value as Record<string, unknown>;
  const mode = data.mode === 'virtual' || data.mode === 'presencial' ? data.mode : undefined;
  const day = pickWeekday(String(data.day ?? ''));
  const hour24 = typeof data.hour24 === 'number' ? data.hour24 : undefined;
  if (!mode || !day || hour24 === undefined || !isHourAllowedByMode(mode, hour24)) return undefined;

  const statusRaw = String(data.status ?? 'agendada').toLowerCase();
  const status = statusRaw === 'cancelada' ? 'cancelada' : 'agendada';
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString();
  const citaId = typeof data.citaId === 'string' ? data.citaId : undefined;
  const assignedStudentName = typeof data.assignedStudentName === 'string' ? data.assignedStudentName : undefined;
  const assignedStudentEmail = typeof data.assignedStudentEmail === 'string' ? data.assignedStudentEmail : undefined;
  const user = typeof data.user === 'object' && data.user !== null ? data.user as Record<string, unknown> : undefined;
  return { mode, day, hour24, status, updatedAt, citaId, assignedStudentName, assignedStudentEmail, user };
}

function getStoredAppointments(profile: Record<string, unknown>): StoredAppointment[] {
  const listRaw = Array.isArray(profile.lastAppointments) ? profile.lastAppointments : [];
  const parsedList = listRaw
    .map((item) => toStoredAppointment(item))
    .filter((item): item is StoredAppointment => Boolean(item));

  const lastRaw = toStoredAppointment(profile.lastAppointment);
  if (lastRaw && !parsedList.some((item) => item.updatedAt === lastRaw.updatedAt)) {
    parsedList.unshift(lastRaw);
  }

  return parsedList
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);
}

function saveStoredAppointments(profile: Record<string, unknown>, list: StoredAppointment): Record<string, unknown>;
function saveStoredAppointments(profile: Record<string, unknown>, list: StoredAppointment[]): Record<string, unknown>;
function saveStoredAppointments(profile: Record<string, unknown>, listOrItem: StoredAppointment | StoredAppointment[]): Record<string, unknown> {
  const list = Array.isArray(listOrItem) ? listOrItem : [listOrItem, ...getStoredAppointments(profile)];
  const normalized = list
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  return {
    ...profile,
    lastAppointment: normalized[0],
    lastAppointments: normalized,
  };
}

function hydrateAppointmentsFromContext(
  profile: Record<string, unknown>,
  contextProfile?: Record<string, unknown>,
): Record<string, unknown> {
  if (!contextProfile) return profile;

  const current = getStoredAppointments(profile);
  const remembered = getStoredAppointments(contextProfile);
  if (remembered.length === 0) return profile;

  const merged = [...current, ...remembered];
  const unique = new Map<string, StoredAppointment>();
  for (const item of merged) {
    const key = `${item.updatedAt}|${item.day}|${item.hour24}|${item.mode}|${item.status}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  const normalized = Array.from(unique.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  if (normalized.length === current.length) {
    const unchanged = normalized.every((item, idx) => {
      const other = current[idx];
      if (!other) return false;
      return item.updatedAt === other.updatedAt
        && item.day === other.day
        && item.hour24 === other.hour24
        && item.mode === other.mode
        && item.status === other.status
        && item.citaId === other.citaId;
    });
    if (unchanged) return profile;
  }

  return saveStoredAppointments(profile, normalized);
}

function markConsultationAsCompleted(profile: Record<string, unknown>): Record<string, unknown> {
  if (profile.consultaEstado === 'finalizada') return profile;

  const currentCount = typeof profile.consultasFinalizadas === 'number' && Number.isFinite(profile.consultasFinalizadas)
    ? profile.consultasFinalizadas
    : 0;

  return {
    ...profile,
    consultasFinalizadas: currentCount + 1,
    consultaEstado: 'finalizada',
    consultaFinalizadaEn: new Date().toISOString(),
    survey: undefined,
  };
}

function markConsultationAsActive(profile: Record<string, unknown>): Record<string, unknown> {
  if (profile.consultaEstado === 'activa' && profile.survey === undefined) return profile;
  return {
    ...profile,
    consultaEstado: 'activa',
    survey: undefined,
  };
}

function buildAppointmentListText(appointments: StoredAppointment[]): string {
  const lines = appointments.map((item, index) => {
    const statusLabel = item.status === 'cancelada' ? 'Cancelada' : 'Agendada';
    return `${index + 1}) ${formatWeekday(item.day)} - ${formatHour(item.hour24)} - ${item.mode} (${statusLabel})`;
  });

  return `Estas son tus citas registradas:\n${lines.join('\n')}`;
}

type ChatbotAvailabilityResult = {
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  mode: 'virtual' | 'presencial';
  hours24: number[];
};

type ChatbotAvailabilityLookup =
  | { status: 'ok'; result: ChatbotAvailabilityResult }
  | { status: 'error'; message: string };

type ChatbotScheduleResult = {
  citaId: string;
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  mode: 'virtual' | 'presencial';
  hour24: number;
  studentName?: string;
  studentEmail?: string;
};

type ChatbotScheduleOutcome =
  | { status: 'ok'; result: ChatbotScheduleResult }
  | { status: 'slot_unavailable'; message: string }
  | { status: 'no_eligible_students'; message: string }
  | { status: 'error'; message: string };

type ChatbotRescheduleOutcome =
  | { status: 'ok'; result: Pick<ChatbotScheduleResult, 'day' | 'hour24' | 'mode'> }
  | { status: 'slot_unavailable'; message: string }
  | { status: 'error'; message: string };

function parseHttpError(rawBody: string): { message: string; code?: string } {
  try {
    const parsed = JSON.parse(rawBody) as { message?: string; code?: string };
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return {
        message: parsed.message.trim(),
        code: typeof parsed?.code === 'string' ? parsed.code : undefined,
      };
    }
  } catch {
    // ignore json parse
  }
  const fallback = rawBody.trim();
  return { message: fallback || 'Error de integración con agenda de citas' };
}

function internalAuthHeaders(correlationId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': correlationId,
  };
  if (env.CHATBOT_INTERNAL_TOKEN) {
    headers['X-Internal-Token'] = env.CHATBOT_INTERNAL_TOKEN;
  }
  return headers;
}

async function fetchChatbotAvailability(input: {
  correlationId: string;
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  mode: 'virtual' | 'presencial';
}): Promise<ChatbotAvailabilityLookup> {
  try {
    const search = new URLSearchParams({ day: input.day, mode: input.mode }).toString();
    const response = await fetch(`${env.AUTH_SERVICE_URL}/api/citas/chatbot/disponibilidad?${search}`, {
      method: 'GET',
      headers: internalAuthHeaders(input.correlationId),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const parsedError = parseHttpError(bodyText);
      const message = parsedError.message;
      log.warn({ correlationId: input.correlationId, day: input.day, mode: input.mode, status: response.status, body: bodyText }, 'No se pudo obtener disponibilidad real de citas');
      return { status: 'error', message };
    }

    const parsed = JSON.parse(bodyText) as any;
    const hoursRaw = Array.isArray(parsed?.data?.horasDisponibles) ? parsed.data.horasDisponibles : [];
    const hours24 = hoursRaw
      .map((value: unknown) => {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
        if (!match) return undefined;
        return Number.parseInt(match[1], 10);
      })
      .filter((value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
      status: 'ok',
      result: {
        day: input.day,
        mode: input.mode,
        hours24,
      },
    };
  } catch (error) {
    log.warn({ correlationId: input.correlationId, error: error instanceof Error ? error.message : String(error) }, 'Error consultando disponibilidad de citas en auth-service');
    return { status: 'error', message: 'No fue posible consultar disponibilidad en este momento.' };
  }
}

async function scheduleChatbotAppointmentInAuth(input: {
  correlationId: string;
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  mode: 'virtual' | 'presencial';
  hour24: number;
  conversationId: string;
  userData: AppointmentUserData;
  reason?: string;
}): Promise<ChatbotScheduleOutcome> {
  try {
    const response = await fetch(`${env.AUTH_SERVICE_URL}/api/citas/chatbot/agendar`, {
      method: 'POST',
      headers: internalAuthHeaders(input.correlationId),
      body: JSON.stringify({
        day: input.day,
        mode: input.mode,
        hour24: input.hour24,
        conversationId: input.conversationId,
        motivo: input.reason,
        userName: input.userData.fullName,
        userDocumentType: input.userData.documentType,
        userDocumentNumber: input.userData.documentNumber,
        userEmail: input.userData.email,
        userPhone: input.userData.phone,
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const parsedError = parseHttpError(bodyText);
      const message = parsedError.message;
      const errorCode = (parsedError.code || '').toUpperCase();
      log.warn({ correlationId: input.correlationId, status: response.status, body: bodyText }, 'No se pudo agendar cita real en auth-service');
      const normalized = normalizeForMatch(message);
      if (response.status === 409 && (errorCode === 'SLOT_NOT_AVAILABLE' || normalized.includes('hora seleccionada no esta disponible') || normalized.includes('slot_not_available') || normalized.includes('no esta disponible'))) {
        return { status: 'slot_unavailable', message };
      }
      if (response.status === 409 && (errorCode === 'NO_ELIGIBLE_STUDENTS' || normalized.includes('no hay estudiantes elegibles') || normalized.includes('no_eligible_students'))) {
        return { status: 'no_eligible_students', message };
      }
      return { status: 'error', message };
    }

    const parsed = JSON.parse(bodyText) as any;
    const citaId = String(parsed?.data?.citaId || '').trim();
    const mode = parsed?.data?.mode === 'presencial' ? 'presencial' : 'virtual';
    const day = pickWeekday(String(parsed?.data?.day || input.day)) || input.day;
    const hour24 = typeof parsed?.data?.hour24 === 'number' ? parsed.data.hour24 : input.hour24;

    if (!citaId) return { status: 'error', message: 'No se recibió identificador de cita desde el servicio de agenda.' };

    return {
      status: 'ok',
      result: {
        citaId,
        day,
        mode,
        hour24,
        studentName: typeof parsed?.data?.estudianteNombre === 'string' ? parsed.data.estudianteNombre : undefined,
        studentEmail: typeof parsed?.data?.estudianteCorreo === 'string' ? parsed.data.estudianteCorreo : undefined,
      },
    };
  } catch (error) {
    log.warn({ correlationId: input.correlationId, error: error instanceof Error ? error.message : String(error) }, 'Error agendando cita real en auth-service');
    return { status: 'error', message: 'No fue posible completar el agendamiento en este momento.' };
  }
}

async function cancelChatbotAppointmentInAuth(input: {
  correlationId: string;
  citaId: string;
}): Promise<boolean> {
  try {
    const response = await fetch(`${env.AUTH_SERVICE_URL}/api/citas/chatbot/cancelar`, {
      method: 'POST',
      headers: internalAuthHeaders(input.correlationId),
      body: JSON.stringify({ citaId: input.citaId }),
    });

    if (response.ok) return true;
    const body = await response.text();
    log.warn({ correlationId: input.correlationId, citaId: input.citaId, status: response.status, body }, 'No se pudo cancelar cita real en auth-service');
    return false;
  } catch (error) {
    log.warn({ correlationId: input.correlationId, citaId: input.citaId, error: error instanceof Error ? error.message : String(error) }, 'Error cancelando cita real en auth-service');
    return false;
  }
}

async function rescheduleChatbotAppointmentInAuth(input: {
  correlationId: string;
  citaId: string;
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  hour24: number;
}): Promise<ChatbotRescheduleOutcome> {
  try {
    const response = await fetch(`${env.AUTH_SERVICE_URL}/api/citas/chatbot/reprogramar`, {
      method: 'POST',
      headers: internalAuthHeaders(input.correlationId),
      body: JSON.stringify({
        citaId: input.citaId,
        day: input.day,
        hour24: input.hour24,
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const parsedError = parseHttpError(bodyText);
      const message = parsedError.message;
      const errorCode = (parsedError.code || '').toUpperCase();
      log.warn({ correlationId: input.correlationId, citaId: input.citaId, status: response.status, body: bodyText }, 'No se pudo reprogramar cita real en auth-service');
      const normalized = normalizeForMatch(message);
      if (response.status === 409 && (errorCode === 'SLOT_NOT_AVAILABLE' || normalized.includes('hora seleccionada no esta disponible') || normalized.includes('slot_not_available') || normalized.includes('no esta disponible'))) {
        return { status: 'slot_unavailable', message };
      }
      return { status: 'error', message };
    }

    const parsed = JSON.parse(bodyText) as any;
    const day = pickWeekday(String(parsed?.data?.day || input.day)) || input.day;
    const hour24 = typeof parsed?.data?.hour24 === 'number' ? parsed.data.hour24 : input.hour24;
    const mode = parsed?.data?.mode === 'presencial' ? 'presencial' : 'virtual';
    return { status: 'ok', result: { day, hour24, mode } };
  } catch (error) {
    log.warn({ correlationId: input.correlationId, citaId: input.citaId, error: error instanceof Error ? error.message : String(error) }, 'Error reprogramando cita real en auth-service');
    return { status: 'error', message: 'No fue posible reprogramar la cita en este momento.' };
  }
}

function pickOptionNumber(text: string): number | undefined {
  const match = text.trim().match(/\d+/);
  if (!match) return undefined;
  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function pickRescheduleField(text: string): 'modalidad' | 'dia' | 'hora' | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized === '1' || normalized.includes('modalidad')) return 'modalidad';
  if (normalized === '2' || normalized.includes('dia')) return 'dia';
  if (normalized === '3' || normalized.includes('hora')) return 'hora';
  return undefined;
}

function buildAppointmentEditConfirmationText(schedule: AppointmentScheduleData): string {
  return `Confírmame los datos de la cita reprogramada:\n- Modalidad: ${schedule.mode}\n- Día: ${formatWeekday(schedule.day)}\n- Hora: ${formatHour(schedule.hour24)}\n\nSi deseas cambiar un dato escribe: cambiar modalidad, cambiar dia o cambiar hora.\nSi todo está correcto escribe: confirmar cita.`;
}

function buildAppointmentCancelConfirmationText(schedule: AppointmentScheduleData): string {
  return `Vas a cancelar esta cita:\n- Modalidad: ${schedule.mode}\n- Día: ${formatWeekday(schedule.day)}\n- Hora: ${formatHour(schedule.hour24)}\n\nSi estás de acuerdo escribe: cancelar cita.`;
}

function evaluateLaboralCompetence(text: string): LaboralCompetenceAssessment {
  const normalized = normalizeForMatch(text);

  const laboralKeywords = [
    'despido',
    'liquidacion',
    'salario',
    'prestaciones',
    'cesantias',
    'vacaciones',
    'indemnizacion',
    'seguridad social',
    'incapacidad',
    'contrato laboral',
    'empleador',
    'trabajo',
  ];

  const nonLaboralKeywords = [
    'homicidio',
    'hurto',
    'divorcio',
    'custodia',
    'alimentos',
    'sucesion',
    'herencia',
    'compraventa',
    'arrendamiento',
    'transito',
    'comparendo',
  ];

  const hasLaboralSignal = laboralKeywords.some((keyword) => normalized.includes(keyword));
  const hasNonLaboralSignal = nonLaboralKeywords.some((keyword) => normalized.includes(keyword));

  const amountMatch = normalized.match(/(\d{1,4})\s*(smlmv|salarios? minimos?)/);
  if (amountMatch) {
    const amount = Number.parseInt(amountMatch[1], 10);
    if (Number.isFinite(amount) && amount > 20) {
      return {
        status: 'not_competent',
        reason: 'La cuantía reportada supera el límite de 20 SMLMV para asuntos laborales del consultorio jurídico.',
      };
    }
  }

  if (hasNonLaboralSignal && !hasLaboralSignal) {
    return {
      status: 'not_competent',
      reason: 'El asunto reportado parece corresponder a un área diferente a laboral.',
    };
  }

  if (hasLaboralSignal) {
    return { status: 'competent' };
  }

  return { status: 'unknown' };
}

function isLaboralSelection(text: string): boolean {
  return text === '1'
    || text === 'laboral'
    || text === 'consulta laboral'
    || text === 'derecho laboral';
}

function isSoporteSelection(text: string): boolean {
  return text === '2' || text.includes('soporte') || text.includes('problema') || text.includes('error');
}

function isAppointmentSelection(text: string): boolean {
  if (isAppointmentRescheduleCommand(text) || isAppointmentCancelCommand(text)) return false;
  return text === '3' || text.includes('agendar cita') || text.includes('agendamiento') || text.includes('cita');
}

function defaultState(): Omit<ConversationState, 'updatedAt' | 'expiresAt'> {
  return {
    stage: 'awaiting_policy_consent',
    category: undefined,
    profile: {},
  };
}

type StatefulFlowResult = {
  responseText: string;
  patch: Record<string, unknown>;
  payload: Record<string, unknown>;
};

type RagFallbackKind = 'none' | 'needs_context' | 'no_content';
const RAG_LOW_CONFIDENCE_ACCEPTANCE_SCORE = 0.35;

async function resolveLaboralQuery(input: {
  queryText: string;
  correlationId: string;
  tenantId: string;
  conversationId: string;
  preferredCaseType?: string;
}): Promise<{ responseText: string; payload: Record<string, unknown>; noSupport: boolean; queryUsed: string; inferredCaseType?: string }> {
  const query = input.queryText.trim();
  if (!query) {
    return {
      responseText: 'Escribe tu consulta laboral para ayudarte mejor.',
      payload: { rag: { status: 'empty_query' }, correlationId: input.correlationId },
      noSupport: true,
      queryUsed: query,
    };
  }

  const inferredFromQuery = inferCaseTypeFromText(query);
  if (shouldUseQuickOrientation(query, inferredFromQuery)) {
    return {
      responseText: truncateForWhatsapp(
        buildFriendlyOrientationResponse(
          buildGuidanceWithOptionalContext(inferredFromQuery),
          buildClarifyingQuestions(inferredFromQuery),
        ),
      ),
      payload: {
        correlationId: input.correlationId,
        inferredCaseType: inferredFromQuery ?? null,
        rag: {
          status: 'skipped_quick_orientation',
          reason: 'short_query_with_detected_case_type',
        },
      },
      noSupport: true,
      queryUsed: query,
      inferredCaseType: inferredFromQuery,
    };
  }

  const ragStartedAt = Date.now();
  try {
    const ragResult = await askRag(query, input.correlationId);
    const inferredFromRag = inferCaseTypeLabel(query, ragResult.answer);
    const inferredCaseType = input.preferredCaseType || inferredFromRag;
    const fallbackKind = pickRagFallbackKind(ragResult);
    const isNoSupport = fallbackKind !== 'none';
    const responseText = fallbackKind === 'none'
      ? buildRagWhatsappText(ragResult, inferredCaseType, query)
      : fallbackKind === 'no_content'
        ? buildFriendlyOrientationResponse(buildNoContentFallback(inferredCaseType))
        : buildFriendlyOrientationResponse(
          buildNeedsContextFallback(inferredCaseType),
          buildClarifyingQuestions(inferredCaseType),
        );

    log.info(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        ragLatencyMs: Date.now() - ragStartedAt,
        ragStatusCode: ragResult.statusCode,
      },
      'RAG response integrated (stateful flow)',
    );

    return {
      responseText,
      payload: {
        correlationId: input.correlationId,
        inferredCaseType: inferredCaseType ?? null,
        rag: {
          statusCode: ragResult.statusCode,
          latencyMs: ragResult.latencyMs,
          citationsCount: ragResult.citations.length,
          usedChunksCount: ragResult.usedChunks.length,
          noSupport: isNoSupport,
          noSupportKind: fallbackKind,
        },
      },
      noSupport: isNoSupport,
      queryUsed: query,
      inferredCaseType,
    };
  } catch (error) {
    const inferredCaseType = input.preferredCaseType || inferCaseTypeFromText(query);
    log.warn(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        error: error instanceof Error ? error.message : String(error),
      },
      'RAG call failed in stateful flow',
    );

    return {
      responseText: buildFriendlyOrientationResponse(
        buildRagServiceErrorFallback(query, inferredCaseType),
        buildClarifyingQuestions(inferredCaseType),
      ),
      payload: {
        correlationId: input.correlationId,
        inferredCaseType: inferredCaseType ?? null,
        rag: {
          status: 'error',
          latencyMs: Date.now() - ragStartedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      },
      noSupport: true,
      queryUsed: query,
      inferredCaseType,
    };
  }
}

async function runStatefulFlow(input: {
  messageIn: MessageIn;
  text: string;
  rawText: string;
  conversationId: string;
  correlationId: string;
  contextProfile?: Record<string, unknown>;
}): Promise<StatefulFlowResult> {
  const key = buildConversationKey(input.messageIn);

  if (isResetCommand(input.text)) {
    const rememberedConsultasFinalizadas =
      typeof input.contextProfile?.consultasFinalizadas === 'number' && Number.isFinite(input.contextProfile?.consultasFinalizadas)
        ? input.contextProfile?.consultasFinalizadas
        : undefined;

    const rememberedLastAppointment =
      input.contextProfile
      && typeof input.contextProfile.lastAppointment === 'object'
      && input.contextProfile.lastAppointment !== null
        ? input.contextProfile.lastAppointment
        : undefined;

    const rememberedLastAppointments = Array.isArray(input.contextProfile?.lastAppointments)
      ? input.contextProfile?.lastAppointments
      : undefined;

    const resetProfile = rememberedLastAppointment
      ? {
        policyAccepted: false,
        ...(rememberedConsultasFinalizadas !== undefined ? { consultasFinalizadas: rememberedConsultasFinalizadas } : {}),
        lastAppointment: rememberedLastAppointment,
        ...(rememberedLastAppointments ? { lastAppointments: rememberedLastAppointments } : {}),
      }
      : {
        policyAccepted: false,
        ...(rememberedConsultasFinalizadas !== undefined ? { consultasFinalizadas: rememberedConsultasFinalizadas } : {}),
      };

    conversationStore.clear(key);
    conversationStore.set(key, {
      ...defaultState(),
      profile: resetProfile,
    });
    return {
      responseText: getDataPolicyText(input.messageIn.channel),
      patch: { intent: 'general', step: 'ask_intent', profile: resetProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', reset: true },
    };
  }

  let state = conversationStore.get(key);
  if (!state) {
    state = conversationStore.set(key, {
      ...defaultState(),
      profile: input.contextProfile ?? {},
    });
  } else {
    const hydratedProfile = hydrateAppointmentsFromContext(
      (state.profile ?? {}) as Record<string, unknown>,
      input.contextProfile,
    );

    if (hydratedProfile !== state.profile) {
      state = conversationStore.set(key, {
        stage: state.stage,
        category: state.category,
        profile: hydratedProfile,
      });
    }
  }

  if (isConversationEndCommand(input.text)) {
    const baseProfile = (state.profile ?? {}) as Record<string, unknown>;
    const profile = markConsultationAsCompleted(baseProfile);
    const survey = typeof profile.survey === 'object' && profile.survey !== null
      ? profile.survey as Record<string, unknown>
      : undefined;
    const alreadyRated = typeof survey?.rating === 'number';

    if (alreadyRated) {
      conversationStore.clear(key);
      conversationStore.set(key, defaultState());
      return {
        responseText: GOODBYE_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', ended: true },
      };
    }

    conversationStore.set(key, {
      stage: 'awaiting_survey_rating',
      category: state.category,
      profile,
    });
    return {
      responseText: SURVEY_RATING_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', surveyFlow: 'ask_rating' },
    };
  }

  if (state.stage === 'awaiting_survey_rating') {
    const rating = pickSurveyRating(input.rawText);
    if (!rating) {
      return {
        responseText: 'No entendí tu calificación. Responde con un número del 1 al 5 (estrellas).',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', surveyFlow: 'rating_invalid' },
      };
    }

    const nextProfile = {
      ...(state.profile ?? {}),
      survey: {
        rating,
        comment: null,
        createdAt: new Date().toISOString(),
      },
    };

    conversationStore.set(key, {
      stage: 'awaiting_survey_comment',
      category: state.category,
      profile: nextProfile,
    });

    return {
      responseText: SURVEY_COMMENT_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', surveyFlow: 'ask_comment', rating },
    };
  }

  if (state.stage === 'awaiting_survey_comment') {
    const profile = (state.profile ?? {}) as Record<string, unknown>;
    const survey = typeof profile.survey === 'object' && profile.survey !== null
      ? { ...(profile.survey as Record<string, unknown>) }
      : {};
    const comment = isSurveySkipComment(input.text) ? null : input.rawText.trim();

    const nextProfile = {
      ...profile,
      survey: {
        ...survey,
        comment: comment && comment.length > 0 ? comment : null,
        updatedAt: new Date().toISOString(),
      },
    };

    const rating = Number((nextProfile.survey as Record<string, unknown>).rating);
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      await persistSurveyInAuthService({
        rating,
        comment: (nextProfile.survey as Record<string, unknown>).comment as string | null,
        correlationId: input.correlationId,
      });
    }

    conversationStore.clear(key);
    conversationStore.set(key, defaultState());

    return {
      responseText: `${SURVEY_THANKS_TEXT}\n\n${GOODBYE_TEXT}`,
      patch: { intent: 'general', step: 'ask_intent', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', surveyFlow: 'completed' },
    };
  }

  if (state.stage === 'awaiting_policy_consent') {
    if (isPolicyAccepted(input.text)) {
      const nextProfile = {
        ...(state.profile ?? {}),
        policyAccepted: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_category',
        category: undefined,
        profile: nextProfile,
      });
      return {
        responseText: MENU_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', policyAccepted: true },
      };
    }

    if (isPolicyRejected(input.text)) {
      conversationStore.clear(key);
      conversationStore.set(key, defaultState());
      return {
        responseText: DATA_POLICY_REJECTED_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile: { policyAccepted: false } },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', policyAccepted: false, ended: true },
      };
    }

    return {
      responseText: getDataPolicyText(input.messageIn.channel),
      patch: { intent: 'general', step: 'ask_intent', profile: { ...(state.profile ?? {}), policyAccepted: false } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', awaitingPolicyConsent: true },
    };
  }
  const profile = (state.profile ?? {}) as Record<string, unknown>;
  const appointment = (typeof profile.appointment === 'object' && profile.appointment !== null)
    ? (profile.appointment as Record<string, unknown>)
    : {};
  const appointmentUser = (typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null)
    ? (profile.appointmentUser as Record<string, unknown>)
    : {};

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_opt') {
    if (isScheduleAppointmentRequest(input.text) || isPositiveReply(input.text)) {
      const nextProfile = markConsultationAsCompleted(markConsultationAsActive(profile));
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_full_name' },
      };
    }

    if (isNegativeReply(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_question',
        category: 'laboral',
        profile: {
          ...profile,
          appointment: undefined,
        },
      });
      return {
        responseText: `Perfecto, continuamos sin agendar cita. ${FOLLOWUP_HINT_TEXT}`,
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_issue',
          profile: {
            ...profile,
            appointment: undefined,
          },
        },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'declined' },
      };
    }

    return {
      responseText: 'Por favor responde: "si, deseo agendar una cita" o "no, gracias".',
      patch: { intent: 'consulta_laboral', step: 'offer_appointment', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'offer' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_full_name') {
    const fullName = pickFullName(input.rawText);
    if (!fullName) {
      return {
        responseText: 'Por favor indícame tu nombre completo (nombre y apellido).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_full_name_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        fullName,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_doc_type',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: APPOINTMENT_DOC_TYPE_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_doc_type' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_doc_type') {
    const documentType = pickDocumentType(input.text);
    if (!documentType) {
      return {
        responseText: 'No entendí el tipo de documento. Responde con una opción: CC, CE, TI, PASAPORTE o PPT.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_doc_type_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        documentType,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_doc_number',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Perfecto. Ahora escribe tu número de documento.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_doc_number' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_doc_number') {
    const documentNumber = pickDocumentNumber(input.rawText);
    if (!documentNumber) {
      return {
        responseText: 'El número de documento no es válido. Inténtalo de nuevo (solo letras, números, punto o guion).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_doc_number_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        documentNumber,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_email',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Gracias. Ahora escribe tu correo electrónico.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_email' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_email') {
    const email = pickEmail(input.rawText);
    if (!email) {
      return {
        responseText: 'El correo no es válido. Escríbelo de nuevo (ejemplo: nombre@dominio.com).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_email_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        email,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    const inferredPhone = pickPhoneFromExternalUserId(input.messageIn.externalUserId);
    if (inferredPhone) {
      const profileWithPhone = {
        ...nextProfile,
        appointmentUser: {
          ...(nextProfile.appointmentUser as Record<string, unknown>),
          phone: inferredPhone,
        },
      };

      conversationStore.set(key, {
        stage: 'awaiting_user_phone_confirm',
        category: 'laboral',
        profile: profileWithPhone,
      });

      return {
        responseText: `Perfecto. Encontré este número de contacto: ${inferredPhone}

Responde con una de estas opciones:
1) Sí, usar este número
2) No, quiero cambiarlo

También puedes escribir directamente el nuevo número (ejemplo: 3001234567).`,
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone_confirm', profile: profileWithPhone },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_confirm' },
      };
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_phone',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Por último, indícame tu número de contacto.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_phone_confirm') {
    const currentPhone = typeof appointmentUser.phone === 'string'
      ? String(appointmentUser.phone)
      : undefined;
    const providedPhone = pickPhone(input.rawText);

    if (providedPhone) {
      const nextProfile = {
        ...profile,
        appointmentUser: {
          ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
          phone: providedPhone,
        },
      };
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: `Perfecto. Guardé el número ${providedPhone}. ${APPOINTMENT_MODE_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_changed' },
      };
    }

    if (isPositiveReply(input.text)) {
      if (!currentPhone) {
        conversationStore.set(key, {
          stage: 'awaiting_user_phone',
          category: 'laboral',
          profile,
        });
        return {
          responseText: 'No pude leer tu número automáticamente. Por favor indícame tu número de contacto.',
          patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_missing' },
        };
      }

      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode' },
      };
    }

    if (isNegativeReply(input.text) || isAppointmentChangePhoneCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_user_phone',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Entendido. Indícame el número de contacto que deseas usar (ejemplo: 3001234567).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_manual' },
      };
    }

    return {
      responseText: 'Para continuar, responde: "sí" (usar este número) o "no" (cambiarlo). También puedes escribir directamente el nuevo número (ejemplo: 3001234567).',
      patch: { intent: 'consulta_laboral', step: 'ask_user_phone_confirm', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_confirm_waiting' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_phone') {
    const phone = pickPhone(input.rawText);
    if (!phone) {
      return {
        responseText: 'El número no es válido. Escríbelo nuevamente solo con números o con prefijo de país.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        phone,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_appointment_mode',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: APPOINTMENT_MODE_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_mode') {
    const userData = pickAppointmentUserData(profile);
    if (!userData) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_data_missing' },
      };
    }

    const mode = pickAppointmentMode(input.text);
    if (!mode) {
      return {
        responseText: 'No te entendí la modalidad. Escribe: presencial o virtual.',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
      },
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_day',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `Perfecto, modalidad ${mode}. Ahora indica el día (lunes a viernes).`,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_day') {
    const day = pickWeekday(input.text);
    if (!day) {
      const weekendMsg = hasWeekendMention(input.text)
        ? 'Solo tenemos agenda de lunes a viernes.'
        : 'No entendí el día.';
      return {
        responseText: `${weekendMsg} Por favor indica un día entre lunes y viernes.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day_invalid' },
      };
    }

    const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
      ? appointment.mode
      : undefined;

    if (!mode) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_missing' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
        day,
      },
    };

    const availability = await fetchChatbotAvailability({
      correlationId: input.correlationId,
      day,
      mode,
    });

    const hasAvailabilityData = availability.status === 'ok';
    const availableHours = hasAvailabilityData ? availability.result.hours24 : [];
    const nextProfileWithAvailability = {
      ...nextProfile,
      appointmentAvailableHours: availableHours,
    };

    if (hasAvailabilityData && availableHours.length === 0) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_day',
        category: 'laboral',
        profile: nextProfileWithAvailability,
      });

      return {
        responseText: `No hay espacios disponibles para ${formatWeekday(day)} en modalidad ${mode}. Indica otro día entre lunes y viernes.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile: nextProfileWithAvailability },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day_no_slots' },
      };
    }

    conversationStore.set(key, {
      stage: 'awaiting_appointment_time',
      category: 'laboral',
      profile: nextProfileWithAvailability,
    });

      return {
      responseText: hasAvailabilityData
        ? `${buildAvailableHoursText(mode, availableHours)} Indica la hora de tu cita.`
        : `${appointmentHourHint(mode)} Indica la hora de tu cita.`,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile: nextProfileWithAvailability },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_time') {
    const isEditOnly = profile.appointmentEditOnly === true;
    const userData = pickAppointmentUserData(profile);
    if (!userData && !isEditOnly) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_data_missing' },
      };
    }

    const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
      ? appointment.mode
      : undefined;
    const day = pickWeekday(String(appointment.day ?? ''));

    if (!mode) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_missing' },
      };
    }

    if (!day) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_day',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Primero necesito el día de la cita. Indica un día entre lunes y viernes.',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day_missing' },
      };
    }

    const hour24 = pickHour24(input.text);
    if (hour24 === undefined) {
      return {
        responseText: `${appointmentHourHint(mode)} Escribe la hora en formato como 8am, 3pm o 15:00.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time_invalid' },
      };
    }

    const availability = await fetchChatbotAvailability({
      correlationId: input.correlationId,
      day,
      mode,
    });
    const hasAvailabilityData = availability.status === 'ok';
    const availableHours = hasAvailabilityData ? availability.result.hours24 : [];
    const selectedIndexForEdit = typeof profile.rescheduleSelectedIndex === 'number'
      ? profile.rescheduleSelectedIndex
      : -1;
    const editCandidates = Array.isArray(profile.rescheduleCandidates)
      ? profile.rescheduleCandidates
        .map((item) => toStoredAppointment(item))
        .filter((item): item is StoredAppointment => Boolean(item))
      : [];
    const selectedForEdit = selectedIndexForEdit >= 0 ? editCandidates[selectedIndexForEdit] : undefined;
    const isSameSlotAsCurrentEdit = Boolean(
      isEditOnly
      && selectedForEdit
      && selectedForEdit.citaId
      && selectedForEdit.day === day
      && selectedForEdit.mode === mode
      && selectedForEdit.hour24 === hour24,
    );

    if (!isHourAllowedByMode(mode, hour24)) {
      return {
        responseText: hasAvailabilityData
          ? `La hora no está disponible para modalidad ${mode}. ${buildAvailableHoursText(mode, availableHours)}`
          : `La hora no está disponible para modalidad ${mode}. ${appointmentHourHint(mode)}`,
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_appointment_time',
          profile: {
            ...profile,
            appointmentAvailableHours: availableHours,
          },
        },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time_out_of_range' },
      };
    }

    if (hasAvailabilityData && !availableHours.includes(hour24) && !isSameSlotAsCurrentEdit) {
      return {
        responseText: `Ese horario ya fue ocupado. ${buildAvailableHoursText(mode, availableHours)} Indica otra hora.`,
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_appointment_time',
          profile: {
            ...profile,
            appointmentAvailableHours: availableHours,
          },
        },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time_taken' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
        day,
        hour24,
      },
      appointmentAvailableHours: availableHours,
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_confirm',
      category: 'laboral',
      profile: nextProfile,
    });

    const schedule: AppointmentScheduleData = { mode, day, hour24 };

    return {
      responseText: isEditOnly
        ? buildAppointmentEditConfirmationText(schedule)
        : buildAppointmentConfirmationText(userData as AppointmentUserData, schedule),
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_confirm') {
    const isEditOnly = profile.appointmentEditOnly === true;

    if (normalizeForMatch(input.text) === 'cancelar') {
      const nextProfile = {
        ...profile,
        appointment: undefined,
        appointmentReturnToConfirm: undefined,
        appointmentEditOnly: undefined,
        rescheduleCandidates: undefined,
        rescheduleSelectedIndex: undefined,
      };

      conversationStore.set(key, {
        stage: 'awaiting_question',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: `Listo, cancelé el proceso de agendamiento. ${FOLLOWUP_HINT_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_process' },
      };
    }

    if (isAppointmentChangeFullNameCommand(input.text)) {
      if (isEditOnly) {
        return {
          responseText: 'En reprogramación solo puedes cambiar modalidad, día u hora. Escribe: cambiar modalidad, cambiar dia o cambiar hora.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_only_schedule_fields' },
        };
      }
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, indícame el nombre completo actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_full_name' },
      };
    }

    if (isAppointmentChangeDocTypeCommand(input.text)) {
      if (isEditOnly) {
        return {
          responseText: 'En reprogramación solo puedes cambiar modalidad, día u hora. Escribe: cambiar modalidad, cambiar dia o cambiar hora.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_only_schedule_fields' },
        };
      }
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_doc_type',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: APPOINTMENT_DOC_TYPE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_doc_type' },
      };
    }

    if (isAppointmentChangeDocNumberCommand(input.text)) {
      if (isEditOnly) {
        return {
          responseText: 'En reprogramación solo puedes cambiar modalidad, día u hora. Escribe: cambiar modalidad, cambiar dia o cambiar hora.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_only_schedule_fields' },
        };
      }
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_doc_number',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, escribe el nuevo número de documento.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_doc_number' },
      };
    }

    if (isAppointmentChangeEmailCommand(input.text)) {
      if (isEditOnly) {
        return {
          responseText: 'En reprogramación solo puedes cambiar modalidad, día u hora. Escribe: cambiar modalidad, cambiar dia o cambiar hora.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_only_schedule_fields' },
        };
      }
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_email',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, escribe el correo actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_email' },
      };
    }

    if (isAppointmentChangePhoneCommand(input.text)) {
      if (isEditOnly) {
        return {
          responseText: 'En reprogramación solo puedes cambiar modalidad, día u hora. Escribe: cambiar modalidad, cambiar dia o cambiar hora.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_only_schedule_fields' },
        };
      }
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_phone',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, indícame el número de contacto actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_phone' },
      };
    }

    if (isAppointmentChangeModeCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_mode' },
      };
    }

    if (isAppointmentChangeDayCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_day',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Perfecto, indícame el nuevo día (lunes a viernes).',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_day' },
      };
    }

    if (isAppointmentChangeHourCommand(input.text)) {
      const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
        ? appointment.mode
        : 'virtual';
      conversationStore.set(key, {
        stage: 'awaiting_appointment_time',
        category: 'laboral',
        profile,
      });
      return {
        responseText: `Perfecto, indícame la nueva hora. ${appointmentHourHint(mode)}`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_time' },
      };
    }

    if (isAppointmentAvailabilityQuestion(input.text)) {
      const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
        ? appointment.mode
        : undefined;
      const day = pickWeekday(String(appointment.day ?? ''));

      if (!mode || !day) {
        conversationStore.set(key, {
          stage: 'awaiting_appointment_day',
          category: 'laboral',
          profile,
        });
        return {
          responseText: 'Para mostrarte disponibilidad exacta necesito el día de la cita. Indica un día entre lunes y viernes.',
          patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'availability_day_missing' },
        };
      }

      const availability = await fetchChatbotAvailability({
        correlationId: input.correlationId,
        day,
        mode,
      });
      const hasAvailabilityData = availability.status === 'ok';
      const availableHours = hasAvailabilityData ? availability.result.hours24 : [];
      const nextProfile = {
        ...profile,
        appointmentAvailableHours: availableHours,
      };

      if (hasAvailabilityData && availableHours.length === 0) {
        conversationStore.set(key, {
          stage: 'awaiting_appointment_day',
          category: 'laboral',
          profile: nextProfile,
        });
        return {
          responseText: `No quedan cupos para ${formatWeekday(day)} en modalidad ${mode}. Indica otro día entre lunes y viernes.`,
          patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile: nextProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'availability_no_slots' },
        };
      }

      conversationStore.set(key, {
        stage: 'awaiting_appointment_time',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: hasAvailabilityData
          ? `${buildAvailableHoursText(mode, availableHours)} Escribe una de esas horas.`
          : `No pude consultar la disponibilidad en este momento. Escribe "cambiar día" y vuelve a intentarlo en unos segundos.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'availability_listed' },
      };
    }

    if (isAppointmentConfirmCommand(input.text)) {
      const isEditOnly = profile.appointmentEditOnly === true;
      const userData = pickAppointmentUserData(profile);
      const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
        ? appointment.mode
        : undefined;
      const day = pickWeekday(String(appointment.day ?? ''));
      const hour24 = typeof appointment.hour24 === 'number' ? appointment.hour24 : undefined;

      if ((!isEditOnly && !userData) || !mode || !day || hour24 === undefined || !isHourAllowedByMode(mode, hour24)) {
        conversationStore.set(key, {
          stage: isEditOnly ? 'awaiting_appointment_day' : 'awaiting_user_full_name',
          category: 'laboral',
          profile,
        });
        return {
          responseText: isEditOnly
            ? 'Falta completar datos de la cita para reprogramar. Indica de nuevo el día (lunes a viernes).'
            : 'Falta completar algunos datos de contacto. Vamos de nuevo. Indica tu nombre completo.',
          patch: { intent: 'consulta_laboral', step: isEditOnly ? 'ask_appointment_day' : 'ask_user_full_name', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'recollect' },
        };
      }

      const appointmentRecordBase: StoredAppointment = {
        mode,
        day,
        hour24,
        status: 'agendada',
        updatedAt: new Date().toISOString(),
        user: (typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null)
          ? profile.appointmentUser as Record<string, unknown>
          : undefined,
      };

      if (isEditOnly) {
        const currentList = getStoredAppointments(profile);
        const selectedIndex = typeof profile.rescheduleSelectedIndex === 'number'
          ? profile.rescheduleSelectedIndex
          : -1;
        const previous = selectedIndex >= 0 && selectedIndex < currentList.length
          ? currentList[selectedIndex]
          : undefined;

        let updatedRecord: StoredAppointment = appointmentRecordBase;
        if (previous?.citaId) {
          const reprogrammed = await rescheduleChatbotAppointmentInAuth({
            correlationId: input.correlationId,
            citaId: previous.citaId,
            day,
            hour24,
          });

          if (reprogrammed.status !== 'ok') {
            if (reprogrammed.status === 'error') {
              return {
                responseText: `No fue posible reprogramar la cita en este momento (${reprogrammed.message}). Intenta nuevamente en unos segundos o escribe "cambiar día" para elegir otra fecha.`,
                patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
                payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_integration_error' },
              };
            }

            const availability = await fetchChatbotAvailability({ correlationId: input.correlationId, day, mode });
            const hasAvailabilityData = availability.status === 'ok';
            const availableHours = hasAvailabilityData ? availability.result.hours24 : [];
            const profileWithAvailability = {
              ...profile,
              appointmentAvailableHours: availableHours,
            };

            if (hasAvailabilityData && availableHours.length === 0) {
              conversationStore.set(key, {
                stage: 'awaiting_appointment_day',
                category: 'laboral',
                profile: profileWithAvailability,
              });
              return {
                responseText: `Ese horario ya no está disponible y no quedan cupos para ${formatWeekday(day)} en modalidad ${mode}. Indica otro día entre lunes y viernes.`,
                patch: {
                  intent: 'consulta_laboral',
                  step: 'ask_appointment_day',
                  profile: profileWithAvailability,
                },
                payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_day_full' },
              };
            }

            conversationStore.set(key, {
              stage: 'awaiting_appointment_time',
              category: 'laboral',
              profile: profileWithAvailability,
            });

            return {
              responseText: hasAvailabilityData
                ? `Ese horario ya no está disponible. ${buildAvailableHoursText(mode, availableHours)} Indica una de esas horas.`
                : `No pude confirmar la disponibilidad real en este momento. Escribe "cambiar día" para intentar con otra fecha.`,
              patch: {
                intent: 'consulta_laboral',
                step: 'ask_appointment_time',
                profile: profileWithAvailability,
              },
              payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_slot_taken' },
            };
          }

          updatedRecord = {
            ...updatedRecord,
            citaId: previous.citaId,
            mode: reprogrammed.result.mode,
            day: reprogrammed.result.day,
            hour24: reprogrammed.result.hour24,
            assignedStudentName: previous.assignedStudentName,
            assignedStudentEmail: previous.assignedStudentEmail,
          };
        }

        if (selectedIndex >= 0 && selectedIndex < currentList.length) {
          currentList[selectedIndex] = {
            ...currentList[selectedIndex],
            ...updatedRecord,
          };
        } else {
          currentList.unshift(updatedRecord);
        }

        const nextProfile = saveStoredAppointments({
          ...profile,
          appointment: undefined,
          appointmentAvailableHours: undefined,
          appointmentEditOnly: undefined,
          rescheduleCandidates: undefined,
          rescheduleSelectedIndex: undefined,
        }, currentList);

        conversationStore.set(key, {
          stage: 'awaiting_question',
          category: 'laboral',
          profile: nextProfile,
        });

        return {
          responseText: `✅ Tu cita fue reprogramada con éxito.\n\n📅 ${formatWeekday(updatedRecord.day)}\n⏰ ${formatHour(updatedRecord.hour24)}\n📍 Modalidad ${updatedRecord.mode}\n\n${FOLLOWUP_HINT_TEXT}`,
          patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'rescheduled' },
        };
      }

      const confirmedUserData = userData as AppointmentUserData;
      const scheduled = await scheduleChatbotAppointmentInAuth({
        correlationId: input.correlationId,
        day,
        mode,
        hour24,
        conversationId: input.conversationId,
        userData: confirmedUserData,
        reason: 'Cita agendada desde chatbot',
      });

      if (scheduled.status !== 'ok') {
        if (scheduled.status === 'no_eligible_students') {
          conversationStore.set(key, {
            stage: 'awaiting_appointment_day',
            category: 'laboral',
            profile,
          });
          return {
            responseText: 'Por ahora no hay estudiantes disponibles para esa modalidad. Indica otro día o cambia modalidad para continuar con el agendamiento.',
            patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
            payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'schedule_no_eligible_students' },
          };
        }

        if (scheduled.status === 'error') {
          return {
            responseText: `No pude completar el agendamiento en este momento (${scheduled.message}). Intenta nuevamente en unos segundos o escribe "cambiar día" para intentar con otra fecha.`,
            patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
            payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'schedule_integration_error' },
          };
        }

        const availability = await fetchChatbotAvailability({ correlationId: input.correlationId, day, mode });
        const hasAvailabilityData = availability.status === 'ok';
        const availableHours = hasAvailabilityData ? availability.result.hours24 : [];
        const profileWithAvailability = {
          ...profile,
          appointmentAvailableHours: availableHours,
        };

        if (hasAvailabilityData && availableHours.length === 0) {
          conversationStore.set(key, {
            stage: 'awaiting_appointment_day',
            category: 'laboral',
            profile: profileWithAvailability,
          });
          return {
            responseText: `Ese horario ya no está disponible y no quedan cupos para ${formatWeekday(day)} en modalidad ${mode}. Indica otro día entre lunes y viernes.`,
            patch: {
              intent: 'consulta_laboral',
              step: 'ask_appointment_day',
              profile: profileWithAvailability,
            },
            payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'schedule_day_full' },
          };
        }

        conversationStore.set(key, {
          stage: 'awaiting_appointment_time',
          category: 'laboral',
          profile: profileWithAvailability,
        });

        return {
          responseText: hasAvailabilityData
            ? `Ese horario ya no está disponible. ${buildAvailableHoursText(mode, availableHours)} Indica una de esas horas.`
            : 'No pude confirmar la disponibilidad real en este momento. Escribe "cambiar día" y vuelve a intentarlo.',
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_appointment_time',
            profile: profileWithAvailability,
          },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'schedule_slot_taken' },
        };
      }

      const scheduledRecord: StoredAppointment = {
        ...appointmentRecordBase,
        mode: scheduled.result.mode,
        day: scheduled.result.day,
        hour24: scheduled.result.hour24,
        citaId: scheduled.result.citaId,
        assignedStudentName: scheduled.result.studentName,
        assignedStudentEmail: scheduled.result.studentEmail,
        user: confirmedUserData as unknown as Record<string, unknown>,
      };

      const nextProfile = saveStoredAppointments({
        ...profile,
        appointmentAvailableHours: undefined,
      }, scheduledRecord);

      conversationStore.set(key, {
        stage: 'awaiting_survey_rating',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: `${buildAppointmentScheduledFriendlyText({
          mode: scheduled.result.mode,
          day: scheduled.result.day,
          hour24: scheduled.result.hour24,
        })}

${scheduled.result.studentName ? `\n👩‍⚖️ Tu cita fue asignada a: *${scheduled.result.studentName}*.` : ''}

${SURVEY_RATING_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
        payload: {
          orchestrator: true,
          correlationId: input.correlationId,
          flow: 'stateful',
          appointmentFlow: 'scheduled',
          surveyFlow: 'ask_rating_after_schedule',
        },
      };
    }

    return {
      responseText: isEditOnly
        ? 'Si deseas continuar, escribe: confirmar cita. Si quieres cambiar la cita escribe: cambiar modalidad, cambiar dia o cambiar hora.'
        : 'Si deseas continuar, escribe: confirmar cita. Si quieres cambiar datos escribe: cambiar nombre, cambiar tipo de documento, cambiar numero de documento, cambiar correo, cambiar numero, cambiar modalidad, cambiar dia o cambiar hora.',
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_waiting' },
    };
  }

  if (state.stage === 'awaiting_category') {
    if (isGreeting(input.text)) {
      return {
        responseText: MENU_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'intro' },
      };
    }

    if (isLaboralSelection(input.text)) {
      const nextProfile = markConsultationAsActive((state.profile ?? {}) as Record<string, unknown>);
      conversationStore.set(key, { stage: 'awaiting_question', category: 'laboral', profile: nextProfile });
      return {
        responseText: 'Perfecto. Escribe tu consulta laboral.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'laboral' },
      };
    }

    if (isAppointmentCancelCommand(input.text)) {
      const profileFromState = (state.profile ?? {}) as Record<string, unknown>;
      const appointments = getStoredAppointments(profileFromState).filter((item) => item.status !== 'cancelada');

      if (appointments.length === 0) {
        return {
          responseText: 'No encuentro una cita agendada para cancelar. Si quieres, puedo ayudarte a agendar una nueva cita.',
          patch: { intent: 'consulta_laboral', step: 'ask_intent', profile: profileFromState },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_not_found' },
        };
      }

      const nextProfile = {
        ...profileFromState,
        cancelCandidates: appointments,
      };

      conversationStore.set(key, { stage: 'awaiting_appointment_cancel_pick', category: 'laboral', profile: nextProfile });
      return {
        responseText: `${buildAppointmentListText(appointments)}\n\nEscribe el número de la cita que deseas cancelar.`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_start' },
      };
    }

    if (isAppointmentRescheduleCommand(input.text)) {
      const profileFromState = (state.profile ?? {}) as Record<string, unknown>;
      const appointments = getStoredAppointments(profileFromState).filter((item) => item.status !== 'cancelada');

      if (appointments.length === 0) {
        return {
          responseText: 'No encuentro una cita previa para reprogramar. Si quieres, puedo ayudarte a agendar una nueva cita.',
          patch: { intent: 'consulta_laboral', step: 'ask_intent', profile: profileFromState },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_not_found' },
        };
      }
      const nextProfile = {
        ...profileFromState,
        rescheduleCandidates: appointments,
      };

      conversationStore.set(key, { stage: 'awaiting_appointment_reschedule_pick', category: 'laboral', profile: nextProfile });
      return {
        responseText: `${buildAppointmentListText(appointments)}\n\nEscribe el número de la cita que deseas reprogramar.`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_start' },
      };
    }

    if (isAppointmentSelection(input.text)) {
      const nextProfile = markConsultationAsCompleted(
        markConsultationAsActive((state.profile ?? {}) as Record<string, unknown>),
      );
      conversationStore.set(key, { stage: 'awaiting_user_full_name', category: 'laboral', profile: nextProfile });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: nextProfile },
        payload: {
          orchestrator: true,
          correlationId: input.correlationId,
          flow: 'stateful',
          category: 'laboral',
          appointmentFlow: 'menu_direct_start',
        },
      };
    }

    if (isSoporteSelection(input.text)) {
      conversationStore.set(key, { stage: 'support', category: 'soporte', profile: state.profile ?? {} });
      return {
        responseText: 'Perfecto. Describe tu problema de soporte para ayudarte.',
        patch: { intent: 'soporte', step: 'collecting_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
      };
    }

    if (input.rawText.trim().length > 0) {
      const baseProfile = state.profile ?? {};
      const initialQuery = input.rawText.trim();
      const inferredInitialCaseType = inferCaseTypeFromText(initialQuery);

      if (!hasLaborEvidence(initialQuery) && !inferredInitialCaseType) {
        return {
          responseText: 'Para orientarte mejor, indícame primero el tipo de caso (laboral, familia, penal, civil, etc.) y un breve resumen en texto de lo ocurrido.',
          patch: {
            intent: 'general',
            step: 'ask_intent',
            profile: {
              ...baseProfile,
              pendingClarification: initialQuery,
            },
          },
          payload: {
            orchestrator: true,
            correlationId: input.correlationId,
            flow: 'stateful',
            category: 'indeterminado',
          },
        };
      }

      const pendingCaseType = typeof baseProfile.pendingCaseType === 'string'
        ? baseProfile.pendingCaseType
        : inferredInitialCaseType;

      const rag = await resolveLaboralQuery({
        queryText: initialQuery,
        correlationId: input.correlationId,
        tenantId: input.messageIn.tenantId,
        conversationId: input.conversationId,
        preferredCaseType: pendingCaseType,
      });

      const nextProfile = markConsultationAsActive({
        ...baseProfile,
        lastLaboralQuery: rag.queryUsed,
        lastRagNoSupport: rag.noSupport,
        pendingCaseType: rag.noSupport ? (rag.inferredCaseType || pendingCaseType || undefined) : undefined,
      });

      conversationStore.set(key, {
        stage: 'awaiting_question',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: rag.responseText,
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_issue',
          profile: nextProfile,
        },
        payload: {
          orchestrator: true,
          flow: 'stateful',
          ...rag.payload,
          directCaseEntry: true,
        },
      };
    }

    return {
      responseText: MENU_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: state.profile ?? {} },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'unknown' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_reschedule_pick') {
    const candidates = Array.isArray(profile.rescheduleCandidates)
      ? (profile.rescheduleCandidates
        .map((item) => toStoredAppointment(item))
        .filter((item): item is StoredAppointment => Boolean(item)))
      : [];

    if (candidates.length === 0) {
      return {
        responseText: 'No encontré citas para reprogramar en este momento. Si deseas, agenda una nueva cita.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_candidates_missing' },
      };
    }

    const selectedNumber = pickOptionNumber(input.rawText);
    if (!selectedNumber || selectedNumber > candidates.length) {
      return {
        responseText: `${buildAppointmentListText(candidates)}\n\nNo entendí tu selección. Escribe solo el número de la cita (ejemplo: 1).`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_pick_invalid' },
      };
    }

    const selected = candidates[selectedNumber - 1];
    const nextProfile = {
      ...profile,
      appointment: {
        mode: selected.mode,
        day: selected.day,
        hour24: selected.hour24,
      },
      appointmentEditOnly: true,
      rescheduleSelectedIndex: selectedNumber - 1,
      rescheduleCandidates: candidates,
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_reschedule_field',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `Seleccionaste la cita #${selectedNumber}: ${formatWeekday(selected.day)} - ${formatHour(selected.hour24)} - ${selected.mode}.\n\n¿Qué dato deseas cambiar?\n1) modalidad\n2) dia\n3) hora`,
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_pick_ok' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_reschedule_field') {
    const field = pickRescheduleField(input.text);
    const isEditOnly = profile.appointmentEditOnly === true;
    if (!isEditOnly) {
      conversationStore.set(key, { stage: 'awaiting_question', category: 'laboral', profile });
      return {
        responseText: 'Reiniciemos la reprogramación. Escribe: reprogramar cita.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_reset' },
      };
    }

    if (!field) {
      return {
        responseText: 'Indícame qué deseas cambiar escribiendo una opción: 1) modalidad, 2) dia, 3) hora.',
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_field_invalid' },
      };
    }

    if (field === 'modalidad') {
      conversationStore.set(key, { stage: 'awaiting_appointment_mode', category: 'laboral', profile });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_change_mode' },
      };
    }

    if (field === 'dia') {
      conversationStore.set(key, { stage: 'awaiting_appointment_day', category: 'laboral', profile });
      return {
        responseText: 'Perfecto, indícame el nuevo día (lunes a viernes).',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_change_day' },
      };
    }

    conversationStore.set(key, { stage: 'awaiting_appointment_time', category: 'laboral', profile });
    const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial' ? appointment.mode : 'virtual';
    return {
      responseText: `Perfecto, indícame la nueva hora. ${appointmentHourHint(mode)}`,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_change_time' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_cancel_pick') {
    const candidates = Array.isArray(profile.cancelCandidates)
      ? (profile.cancelCandidates
        .map((item) => toStoredAppointment(item))
        .filter((item): item is StoredAppointment => Boolean(item)))
      : [];

    if (candidates.length === 0) {
      return {
        responseText: 'No encontré citas para cancelar en este momento. Si deseas, agenda una nueva cita.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_candidates_missing' },
      };
    }

    const selectedNumber = pickOptionNumber(input.rawText);
    if (!selectedNumber || selectedNumber > candidates.length) {
      return {
        responseText: `${buildAppointmentListText(candidates)}\n\nNo entendí tu selección. Escribe solo el número de la cita (ejemplo: 1).`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_pick_invalid' },
      };
    }

    const selected = candidates[selectedNumber - 1];
    const nextProfile = {
      ...profile,
      cancelCandidates: candidates,
      cancelSelectedIndex: selectedNumber - 1,
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_cancel_confirm',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: buildAppointmentCancelConfirmationText(selected),
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_pick_ok' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_cancel_confirm') {
    const candidates = Array.isArray(profile.cancelCandidates)
      ? (profile.cancelCandidates
        .map((item) => toStoredAppointment(item))
        .filter((item): item is StoredAppointment => Boolean(item)))
      : [];
    const selectedIndex = typeof profile.cancelSelectedIndex === 'number' ? profile.cancelSelectedIndex : -1;

    if (selectedIndex < 0 || selectedIndex >= candidates.length) {
      conversationStore.set(key, { stage: 'awaiting_appointment_cancel_pick', category: 'laboral', profile });
      return {
        responseText: 'No pude identificar la cita a cancelar. Volvamos a elegirla por número.',
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_selection_lost' },
      };
    }

    if (!isAppointmentCancelCommand(input.text)) {
      return {
        responseText: 'Para cancelar esa cita escribe: cancelar cita. Si cambias de idea, escribe reset.',
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_waiting_confirm' },
      };
    }

    const currentList = getStoredAppointments(profile);
    const chosen = currentList[selectedIndex] ?? candidates[selectedIndex];

    if (chosen.citaId) {
      const cancelled = await cancelChatbotAppointmentInAuth({
        correlationId: input.correlationId,
        citaId: chosen.citaId,
      });

      if (!cancelled) {
        return {
          responseText: 'No fue posible cancelar esa cita en este momento. Intenta nuevamente en unos segundos.',
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_failed' },
        };
      }
    }

    const updated: StoredAppointment = {
      ...chosen,
      status: 'cancelada',
      updatedAt: new Date().toISOString(),
    };
    if (selectedIndex >= 0 && selectedIndex < currentList.length) {
      currentList[selectedIndex] = { ...currentList[selectedIndex], ...updated };
    } else {
      currentList.unshift(updated);
    }

    const nextProfile = saveStoredAppointments({
      ...profile,
      cancelCandidates: undefined,
      cancelSelectedIndex: undefined,
    }, currentList);

    conversationStore.set(key, {
      stage: 'awaiting_question',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `✅ Tu cita fue cancelada con éxito.\n\n📅 ${formatWeekday(updated.day)}\n⏰ ${formatHour(updated.hour24)}\n📍 Modalidad ${updated.mode}\n\n${FOLLOWUP_HINT_TEXT}`,
      patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancelled' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_question') {
    if (isAppointmentCancelCommand(input.text)) {
      const appointments = getStoredAppointments(profile).filter((item) => item.status !== 'cancelada');

      if (appointments.length === 0) {
        return {
          responseText: 'No encuentro una cita agendada para cancelar. Si quieres, puedo ayudarte a agendar una nueva.',
          patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_not_found' },
        };
      }

      const nextProfile = {
        ...profile,
        cancelCandidates: appointments,
      };

      conversationStore.set(key, {
        stage: 'awaiting_appointment_cancel_pick',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: `${buildAppointmentListText(appointments)}\n\nEscribe el número de la cita que deseas cancelar.`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'cancel_start' },
      };
    }

    if (isAppointmentRescheduleCommand(input.text)) {
      const appointments = getStoredAppointments(profile).filter((item) => item.status !== 'cancelada');

      if (appointments.length === 0) {
        return {
          responseText: 'No encuentro una cita previa para reprogramar. Si quieres, puedo ayudarte a agendar una nueva cita.',
          patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_not_found' },
        };
      }

      const nextProfile = {
        ...profile,
        rescheduleCandidates: appointments,
      };

      conversationStore.set(key, {
        stage: 'awaiting_appointment_reschedule_pick',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: `${buildAppointmentListText(appointments)}\n\nEscribe el número de la cita que deseas reprogramar.`,
        patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'reschedule_start' },
      };
    }

    if (isScheduleAppointmentRequest(input.text)) {
      const nextProfile = markConsultationAsCompleted(markConsultationAsActive(profile));
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'direct_start_collect_user' },
      };
    }

    if (isNoMoreDoubtsMessage(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_opt',
        category: 'laboral',
        profile,
      });
      return {
        responseText: `Perfecto. ${APPOINTMENT_OFFER_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'offer_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', closureHint: true, appointmentFlow: 'offer' },
      };
    }

    if (isAnotherQuestionPrompt(input.text)) {
      return {
        responseText: `Claro, cuéntame tu otra duda y te ayudo. ${FOLLOWUP_HINT_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', awaitingNewQuestion: true },
      };
    }

    if (!env.ORCH_RAG_ENABLED) {
      return {
        responseText: 'El modo de consulta jurídica está desactivado temporalmente. Intenta en unos minutos.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', ragEnabled: false },
      };
    }

    const previousQuery = typeof profile.lastLaboralQuery === 'string' ? profile.lastLaboralQuery : '';
    const previousNoSupport = profile.lastRagNoSupport === true;
    const currentText = input.rawText.trim();
    const pendingCaseType = typeof profile.pendingCaseType === 'string' ? profile.pendingCaseType : undefined;

    const queryText = previousNoSupport && previousQuery
      ? `${previousQuery}\n\nDetalles adicionales del usuario: ${currentText}`
      : currentText;

    const rag = await resolveLaboralQuery({
      queryText,
      correlationId: input.correlationId,
      tenantId: input.messageIn.tenantId,
      conversationId: input.conversationId,
      preferredCaseType: pendingCaseType,
    });

    const nextPendingCaseType = rag.noSupport
      ? (rag.inferredCaseType || pendingCaseType || inferCaseTypeFromText(previousQuery) || undefined)
      : undefined;

    const nextProfile = markConsultationAsActive({
      ...profile,
      lastLaboralQuery: rag.queryUsed,
      lastRagNoSupport: rag.noSupport,
      pendingCaseType: nextPendingCaseType,
    });

    conversationStore.set(key, {
      stage: 'awaiting_question',
      category: 'laboral',
      profile: nextProfile,
    });
    return {
      responseText: rag.responseText,
      patch: {
        intent: 'consulta_laboral',
        step: 'ask_issue',
        profile: nextProfile,
      },
      payload: {
        orchestrator: true,
        flow: 'stateful',
        ...rag.payload,
        ragContextAugmented: previousNoSupport && Boolean(previousQuery),
      },
    };
  }

  if (state.category === 'soporte' || state.stage === 'support') {
    conversationStore.set(key, { stage: 'support', category: 'soporte', profile: { issue: input.rawText.trim() } });
    return {
      responseText: 'Gracias. Registré tu caso de soporte y te ayudaré con un asesor. Si deseas empezar de nuevo escribe reset.',
      patch: { intent: 'soporte', step: 'collecting_issue', profile: { issue: input.rawText.trim() } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
    };
  }

  conversationStore.set(key, defaultState());
  return {
    responseText: MENU_TEXT,
    patch: { intent: 'general', step: 'ask_intent', profile: {} },
    payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', fallback: true },
  };
}

export async function __testOnly_runStatefulFlow(input: {
  messageIn: MessageIn;
  conversationId: string;
  correlationId: string;
  contextProfile?: Record<string, unknown>;
}): Promise<StatefulFlowResult> {
  const extractedText = extractText(input.messageIn);
  return runStatefulFlow({
    messageIn: input.messageIn,
    text: extractedText,
    rawText: extractedText,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    contextProfile: input.contextProfile,
  });
}

function localFallbackAI(text: string): AIResult {
  const shouldReset = text.includes('menu') || text.includes('cambiar');

  let intent: Intent = 'general';
  if (text.includes('laboral') || text.includes('trabajo') || text.includes('empleo')) {
    intent = 'consulta_laboral';
  } else if (text.includes('soporte') || text.includes('error') || text.includes('problema')) {
    intent = 'soporte';
  }

  return {
    intent: shouldReset ? 'general' : intent,
    confidence: 0,
    entities: {},
    shouldReset,
  };
}

function pickEntityCity(ai: AIResult): string | undefined {
  const city = ai.entities?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : undefined;
}

function pickEntityAge(ai: AIResult): number | undefined {
  const age = ai.entities?.age;
  return typeof age === 'number' && age > 0 && age <= 120 ? age : undefined;
}

function isHardResetCommand(text: string): boolean {
  return [
    'reset',
    'reiniciar',
    'menu',
    'menú',
    'inicio',
    'empezar',
    'comenzar',
  ].includes(text);
}

function isGreeting(text: string): boolean {
  return [
    'hola',
    'holi',
    'buenas',
    'hello',
    'hi',
  ].includes(text);
}

function decideNextAction(text: string, context: OrchestratorContext, ai: AIResult): Decision {
  const shouldForceReset = isHardResetCommand(text)
    || (isGreeting(text) && context.step === 'ready_for_handoff');

  if (ai.shouldReset === true || shouldForceReset) {
    return {
      patch: { intent: 'general', step: 'ask_intent', profile: {} },
      responseText: 'Listo 👋 ¿En qué te puedo ayudar? Responde: laboral o soporte.',
      nextIntent: 'general',
      nextStep: 'ask_intent',
    };
  }

  const cityFromAI = pickEntityCity(ai);
  const ageFromAI = pickEntityAge(ai);

  if (!context.step || context.step === 'ask_intent' || !context.intent) {
    if (normalizeIntent(ai.intent) === 'consulta_laboral') {
      if (cityFromAI && ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ready_for_handoff',
            profile: { city: cityFromAI, age: ageFromAI },
          },
          responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
          nextIntent: 'consulta_laboral',
          nextStep: 'ready_for_handoff',
        };
      }

      if (cityFromAI && !ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
            profile: { city: cityFromAI },
          },
          responseText: 'Gracias. ¿Cuál es tu edad?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_city',
          ...(ageFromAI ? { profile: { age: ageFromAI } } : {}),
        },
        responseText: 'Perfecto. ¿En qué ciudad estás?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_city',
      };
    }

    if (normalizeIntent(ai.intent) === 'soporte') {
      return {
        patch: { intent: 'soporte', step: 'collecting_issue' },
        responseText: 'Entendido. Cuéntame cuál es el problema.',
        nextIntent: 'soporte',
        nextStep: 'collecting_issue',
      };
    }

    return {
      patch: {
        intent: context.intent ?? 'general',
        step: 'ask_intent',
      },
      responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
      nextIntent: context.intent ?? 'general',
      nextStep: 'ask_intent',
    };
  }

  if (context.intent === 'consulta_laboral') {
    if (context.step === 'ask_city') {
      const city = cityFromAI ?? text.trim();
      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_age',
          profile: { city },
        },
        responseText: 'Gracias. ¿Cuál es tu edad?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_age',
      };
    }

    if (context.step === 'ask_age') {
      const age = ageFromAI ?? parseAge(text);
      if (!age) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
          },
          responseText: '¿Me confirmas tu edad en números?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ready_for_handoff',
          profile: { age },
        },
        responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
        nextIntent: 'consulta_laboral',
        nextStep: 'ready_for_handoff',
      };
    }
  }

  if (context.intent === 'soporte') {
    return {
      patch: {
        intent: 'soporte',
        step: 'ready_for_handoff',
        profile: { issue: text },
      },
      responseText: 'Perfecto. Ya registré tu caso. Te paso con un asesor.',
      nextIntent: 'soporte',
      nextStep: 'ready_for_handoff',
    };
  }

  return {
    patch: { intent: 'general', step: 'ask_intent' },
    responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
    nextIntent: 'general',
    nextStep: 'ask_intent',
  };
}

function shouldUseRag(intent: Intent, text: string): boolean {
  if (!env.ORCH_RAG_ENABLED) return false;
  if (intent !== 'consulta_laboral' && intent !== 'consulta_juridica') return false;
  return text.trim().length > 0;
}

function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pickRagFallbackKind(result: RagAnswerResult): RagFallbackKind {
  const normalizedAnswer = normalizeAnswer(result.answer);
  const noInfoAnswer = normalizedAnswer.includes('no tengo suficiente informacion en el documento')
    || normalizedAnswer.includes('no encontre suficiente soporte');

  if (result.status === 'no_context' && result.citations.length === 0 && result.usedChunks.length === 0) {
    return 'needs_context';
  }

  if (result.status === 'low_confidence') {
    const hasEvidence = result.citations.length > 0 || result.usedChunks.length > 0;
    if (hasEvidence && (result.bestScore ?? 0) >= 0.2) {
      return 'none';
    }
    if (!hasEvidence) {
      return 'needs_context';
    }
    return 'needs_context';
  }

  if (noInfoAnswer) {
    if (result.citations.length === 0 && result.usedChunks.length === 0) return 'needs_context';
    return 'none';
  }

  return 'none';
}

function truncateForWhatsapp(text: string, max = 3000): string {
  if (text.length <= max) return text;

  const candidate = text.slice(0, max - 1);
  const breakpoints = [candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('. '), candidate.lastIndexOf(' ')];
  const cutAt = Math.max(...breakpoints.filter((idx) => idx > Math.floor(max * 0.7)));
  const safeCut = cutAt > 0 ? cutAt : max - 1;

  return `${candidate.slice(0, safeCut).trimEnd()}…`;
}

function sanitizeRagAnswerForUser(answer: string): string {
  const withoutChunkRefs = answer
    .replace(/\(\s*source\s*:\s*\d+\s*\)/gi, '')
    .replace(/\(\s*[a-z0-9_\- ]{2,60}\s*:\s*\d+\s*\)/gi, '');
  const withoutSourcesFooter = withoutChunkRefs.replace(/\n\nFuentes:[\s\S]*$/i, '');
  const withoutNoInfoPhrases = withoutSourcesFooter
    .replace(/no tengo suficiente informacion en el documento[^.]*\.?/gi, '')
    .replace(/no encontre suficiente soporte[^.]*\.?/gi, '')
    .replace(/necesito mas contexto[^.]*\.?/gi, '');
  return withoutNoInfoPhrases.replace(/\s{2,}/g, ' ').trim();
}

function buildFriendlyOrientationResponse(mainText: string, detailPrompt = ORIENTATION_DETAIL_PROMPT): string {
  return `📌 *Orientación preliminar*\n\n${mainText}\n\n${detailPrompt}\n\n⚠️ *Importante:*\n${PRELIMINARY_GUIDANCE_DISCLAIMER}\n\n${FOLLOWUP_HINT_TEXT}`;
}

function isBotInfoQuery(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'que tipos de casos atiendes',
    'que tipo de casos atiendes',
    'que casos atiendes',
    'quien eres',
    'que puedes hacer',
    'como funcionas',
    'como funciona',
    'que hace el bot',
    'que haces',
  ].some((item) => normalized.includes(item));
}

function inferCaseTypeFromText(text: string): string | undefined {
  const normalized = normalizeForMatch(text);
  const matchers: Array<{ label: string; keys: string[] }> = [
    {
      label: 'Laboral',
      keys: [
        'laboral',
        'despido',
        'me echaron',
        'me saco de la empresa',
        'terminacion de contrato',
        'terminaron mi contrato',
        'liquidacion',
        'empleador',
        'contrato de trabajo',
        'salario',
        'no me pagan',
        'no me pagaron',
        'cesantias',
        'vacaciones',
        'prestaciones',
        'indemnizacion',
        'acoso laboral',
      ],
    },
    {
      label: 'Penal',
      keys: [
        'penal',
        'victima',
        'acusador',
        'querellable',
        'homicidio',
        'hurto',
        'fiscalia',
        'violacion',
        'violar',
        'abuso sexual',
        'agresion sexual',
        'acoso sexual',
        'violencia sexual',
        'violencia intrafamiliar',
        'me golpe',
        'golpearon',
        'maltrat',
        'amenaz',
        'extorsion',
        'costillas rotas',
        'lesion',
        'denunciar',
      ],
    },
    { label: 'Civil', keys: ['civil', 'jueces municipales', 'compraventa', 'arrendamiento', 'incumplimiento de contrato', 'deuda', 'pagare', 'pagaré'] },
    {
      label: 'Familia',
      keys: [
        'familia',
        'patria potestad',
        'custodia',
        'comisarias de familia',
        'separar',
        'separacion',
        'divorcio',
        'divorci',
        'pareja',
        'matrimonio',
        'esposa',
        'esposo',
        'union marital',
      ],
    },
    { label: 'Constitucional', keys: ['tutela', 'cumplimiento', 'populares', 'derecho de peticion'] },
    { label: 'Administrativo', keys: ['administrativa', 'superintendencia', 'sede administrativa', 'recursos', 'peticion', 'queja', 'reclamacion'] },
    { label: 'Conciliación', keys: ['conciliacion', 'centro de conciliacion', 'conciliables', 'conciliar'] },
    { label: 'Tránsito', keys: ['transito', 'contravencionales', 'comparendo', 'multa', 'accidente de transito', 'choque'] },
    { label: 'Disciplinario', keys: ['disciplinario', 'procuraduria', 'falta disciplinaria'] },
    { label: 'Responsabilidad fiscal', keys: ['responsabilidad fiscal', 'contraloria', 'hallazgo fiscal'] },
    { label: 'Comercial', keys: ['comercial', 'camara de comercio', 'sociedad', 'empresa', 'mercantil'] },
  ];

  for (const matcher of matchers) {
    if (matcher.keys.some((key) => normalized.includes(key))) return matcher.label;
  }

  return undefined;
}

function inferCaseTypeLabel(query: string, _answer: string): string | undefined {
  if (isBotInfoQuery(query)) return undefined;
  const fromQuery = inferCaseTypeFromText(query);
  if (fromQuery) return fromQuery;
  return undefined;
}

function hasLaborEvidence(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'trabajo',
    'laboral',
    'empleo',
    'empleador',
    'despido',
    'echaron',
    'me echaron',
    'desvincularon',
    'terminaron mi contrato',
    'renuncia',
    'liquidacion',
    'liquidación',
    'prestaciones',
    'indemnizacion',
    'no me pagan',
    'no me pagaron',
    'contrato de trabajo',
    'salario',
    'nomina',
    'nómina',
    'horas extra',
    'incapacidad laboral',
    'acoso laboral',
    'arl',
    'eps',
  ].some((term) => normalized.includes(term));
}

function shouldUseQuickOrientation(query: string, caseType?: string): boolean {
  if (!caseType) return false;
  if (hasSpecificContextInQuery(query, caseType)) return false;
  const words = normalizeForMatch(query).split(/\s+/).filter(Boolean);
  return words.length <= 7;
}

function buildNeedsContextFallback(caseType?: string): string {
  if (caseType === 'Laboral') {
    return 'Para orientarte mejor en este caso laboral, necesito algunos datos puntuales.';
  }
  if (caseType === 'Familia') {
    return 'Para orientarte bien en este caso de familia, necesito algunos datos puntuales.';
  }
  if (caseType === 'Penal') {
    return 'Para orientarte mejor en este caso penal, necesito algunos datos puntuales.';
  }
  if (caseType === 'Constitucional') {
    return 'Para orientarte mejor en este caso constitucional, necesito algunos datos puntuales.';
  }
  if (caseType) {
    return `Para orientarte mejor en este caso de ${caseType.toLowerCase()}, necesito algunos datos puntuales.`;
  }
  return 'Para orientarte mejor, necesito algunos datos puntuales del caso.';
}

function buildClarifyingQuestions(caseType?: string): string {
  if (caseType === 'Familia') {
    return 'Para darte una guía más útil, respóndeme estas preguntas rápidas:\n1) ¿El divorcio sería de mutuo acuerdo o hay conflicto?\n2) ¿Hay hijos menores o acuerdos de custodia/alimentos?\n3) ¿Hay bienes o deudas por repartir?\n\nCon esas respuestas te doy una ruta clara paso a paso.';
  }
  if (caseType === 'Laboral') {
    return 'Para darte una orientación más precisa, respóndeme estas preguntas:\n1) ¿Qué tipo de contrato tenías (verbal, fijo, indefinido, prestación)?\n2) ¿En qué fecha fue el despido o el hecho principal?\n3) ¿Te deben salarios, prestaciones o indemnización?\n\nCon eso te explico la mejor ruta de acción.';
  }
  if (caseType === 'Penal') {
    return 'Para orientarte mejor, ayúdame con estos datos:\n1) ¿Qué ocurrió exactamente y cuándo pasó?\n2) ¿Ya denunciaste o estás en alguna etapa del proceso?\n3) ¿Tienes pruebas o testigos?\n\nCon esto te indico la ruta más adecuada.';
  }
  if (caseType === 'Constitucional') {
    return 'Para orientarte mejor, compárteme:\n1) ¿Qué derecho consideras vulnerado?\n2) ¿Quién lo vulneró (entidad o particular)?\n3) ¿Ya presentaste petición o reclamación previa?\n\nCon eso te digo si procede tutela u otra acción.';
  }
  return 'Para orientarte mejor, respóndeme estas preguntas:\n1) ¿Cuál es el hecho principal?\n2) ¿Cuándo ocurrió?\n3) ¿Qué resultado esperas obtener?\n\nCon eso te doy una orientación más concreta.';
}

function buildNoContentFallback(caseType?: string): string {
  if (caseType) {
    return `No encontré suficiente contenido del consultorio para responder con seguridad este caso de ${caseType.toLowerCase()}. Si quieres, dame más detalles y lo intento de nuevo.`;
  }
  return RAG_NO_CONTENT_FALLBACK;
}

function buildGeneralGuidanceByCaseType(caseType?: string): string {
  if (caseType === 'Familia') {
    return 'Con lo que me compartes, en un caso de familia puedes empezar por reunir documentos clave (registro civil, pruebas de convivencia o de la situación) y definir si buscas conciliación o demanda según el objetivo (por ejemplo, divorcio, custodia o alimentos).';
  }
  if (caseType === 'Laboral') {
    return 'Con lo que me indicas, en un caso laboral conviene reunir contrato, desprendibles de pago y comunicaciones con el empleador para revisar posibles vulneraciones y definir la ruta (conciliación, reclamación o demanda).';
  }
  if (caseType === 'Penal') {
    return 'Con lo que narras, en materia penal es importante conservar pruebas, registrar hechos con fechas y acudir a denuncia formal cuando corresponda para activar la ruta de protección y judicialización.';
  }
  if (caseType === 'Constitucional') {
    return 'Con la información actual, puedes identificar el derecho fundamental posiblemente vulnerado y la entidad responsable para evaluar acciones como derecho de petición o tutela.';
  }
  return 'Con la información que me compartes ya puedo darte una orientación preliminar y una ruta inicial de acción.';
}

function isUrgentProtectionContext(query: string): boolean {
  const normalized = normalizeForMatch(query);
  return [
    'violacion',
    'abuso sexual',
    'agresion sexual',
    'violencia sexual',
    'violencia intrafamiliar',
    'me pego',
    'me golpeo',
    'amenaza',
    'riesgo',
    'peligro',
  ].some((k) => normalized.includes(k));
}

function buildRagServiceErrorFallback(query: string, caseType?: string): string {
  const inferredCaseType = caseType || inferCaseTypeFromText(query);
  const baseGuidance = buildGeneralGuidanceByCaseType(inferredCaseType);

  if (isUrgentProtectionContext(query)) {
    return `No pude consultar la base jurídica en este momento, pero sí puedo darte una ruta inicial de seguridad.

${baseGuidance}

Si estás en riesgo inmediato, contacta emergencias (123) y, si aplica, la Línea 155 (orientación a mujeres víctimas de violencia en Colombia). También puedes acudir a Fiscalía o Comisaría de Familia según el caso.`;
  }

  return `No pude consultar la base jurídica en este momento por un problema técnico. Mientras se restablece, te comparto una orientación inicial:

${baseGuidance}`;
}

function buildGuidanceWithOptionalContext(caseType?: string): string {
  return buildGeneralGuidanceByCaseType(caseType);
}

function hasSpecificContextInQuery(query: string, caseType?: string): boolean {
  const normalized = normalizeForMatch(query);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length >= 12) return true;
  if (/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b|\b\d+\b/.test(normalized)) return true;

  if (caseType === 'Familia') {
    return ['hijos', 'custodia', 'alimentos', 'bienes', 'deudas', 'mutuo acuerdo', 'violencia', 'separados']
      .some((k) => normalized.includes(k));
  }
  if (caseType === 'Laboral') {
    return ['contrato', 'despido', 'liquidacion', 'salario', 'prestaciones', 'indemnizacion', 'fecha']
      .some((k) => normalized.includes(k));
  }
  if (caseType === 'Penal') {
    return ['denuncia', 'fiscalia', 'hechos', 'pruebas', 'testigos', 'lesiones']
      .some((k) => normalized.includes(k));
  }

  return words.length >= 8;
}

function buildRagWhatsappText(result: RagAnswerResult, caseType?: string, queryText?: string): string {
  if (queryText && !hasSpecificContextInQuery(queryText, caseType)) {
    return truncateForWhatsapp(
      buildFriendlyOrientationResponse(
        buildNeedsContextFallback(caseType),
        buildClarifyingQuestions(caseType),
      ),
    );
  }

  const base = sanitizeRagAnswerForUser(result.answer.trim());
  if (base.length < 40) {
    return truncateForWhatsapp(buildFriendlyOrientationResponse(buildGuidanceWithOptionalContext(caseType)));
  }
  const prefix = caseType ? `Tipo de caso: ${caseType}\n\n` : '';
  return truncateForWhatsapp(buildFriendlyOrientationResponse(`${prefix}${base}`));
}

export const orchestratorService = {
  async handleMessage(messageIn: MessageIn, requestId?: string): Promise<OrchestratorResponse> {
    const correlationId = requestId ?? randomUUID();
    const channel = mapChannel(messageIn.channel);
    const incomingType = mapMessageType(messageIn.message.type);
    const extractedRawText = extractRawText(messageIn);
    const extractedText = extractText(messageIn);

    const contact = await conversationClient.upsertContact({
      tenantId: messageIn.tenantId,
      channel,
      externalId: messageIn.externalUserId,
      displayName: messageIn.displayName,
      requestId: correlationId,
    });

    const conversation = await conversationClient.getOrCreateConversation({
      tenantId: messageIn.tenantId,
      contactId: contact.id,
      channel,
      requestId: correlationId,
    });

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'IN',
      type: incomingType,
      text: extractedRawText,
      payload: {
        ...(messageIn.message.payload ?? {}),
        extractedText,
        extractedRawText,
      },
      providerMessageId: messageIn.message.providerMessageId,
      requestId: correlationId,
    });

    const latestContext = await conversationClient.getLatestContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      requestId: correlationId,
    });
    const context = parseContext(latestContext.data);

    let ai: AIResult = localFallbackAI(extractedText);
    let patch: Record<string, unknown>;
    let responseText = '';
    let responsePayload: Record<string, unknown> = { orchestrator: true, correlationId };
    let nextIntent: Intent = 'general';
    let nextStep: Step = 'ask_intent';

    if (env.ORCH_FLOW_MODE === 'stateful') {
      const statefulResult = await runStatefulFlow({
        messageIn,
        text: extractedText,
        rawText: extractedRawText,
        conversationId: conversation.id,
        correlationId,
        contextProfile: context.profile,
      });
      responseText = statefulResult.responseText;
      responsePayload = statefulResult.payload;
      patch = statefulResult.patch;
      nextIntent = normalizeIntent(typeof patch.intent === 'string' ? patch.intent : 'general');
      nextStep = typeof patch.step === 'string' ? (patch.step as Step) : 'ask_intent';
    } else {
      try {
        ai = await classifyExtract(extractedRawText);
      } catch (error) {
        log.warn(
          {
            requestId: correlationId,
            tenantId: messageIn.tenantId,
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'AI classify failed, using fallback',
        );
        ai = localFallbackAI(extractedText);
      }

      const decision = decideNextAction(extractedText, context, ai);
      patch = decision.patch;
      responseText = decision.responseText;
      responsePayload = { orchestrator: true, correlationId };
      nextIntent = decision.nextIntent;
      nextStep = decision.nextStep;

      const intentForRag = normalizeIntent(decision.nextIntent);
      if (shouldUseRag(intentForRag, extractedRawText)) {
        const ragStartedAt = Date.now();
        const query = extractedRawText.trim();

        try {
          const ragResult = await askRag(query, correlationId);
          const inferredCaseType = inferCaseTypeLabel(query, ragResult.answer);
          const fallbackKind = pickRagFallbackKind(ragResult);
          const isNoSupport = fallbackKind !== 'none';
          responseText = fallbackKind === 'none'
            ? buildRagWhatsappText(ragResult, inferredCaseType, query)
            : fallbackKind === 'no_content'
              ? buildFriendlyOrientationResponse(buildNoContentFallback(inferredCaseType))
              : buildFriendlyOrientationResponse(
                buildNeedsContextFallback(inferredCaseType),
                buildClarifyingQuestions(inferredCaseType),
              );
          responsePayload = {
            ...responsePayload,
            inferredCaseType: inferredCaseType ?? null,
            rag: {
              statusCode: ragResult.statusCode,
              latencyMs: ragResult.latencyMs,
              citationsCount: ragResult.citations.length,
              usedChunksCount: ragResult.usedChunks.length,
              topChunk: ragResult.usedChunks[0]?.chunkIndex ?? null,
              noSupport: isNoSupport,
              noSupportKind: fallbackKind,
            },
          };

          log.info(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              ragLatencyMs: Date.now() - ragStartedAt,
              ragStatusCode: ragResult.statusCode,
            },
            'RAG response integrated',
          );
        } catch (error) {
          const inferredCaseType = inferCaseTypeFromText(query);
          responseText = buildFriendlyOrientationResponse(
            buildRagServiceErrorFallback(query, inferredCaseType),
            buildClarifyingQuestions(inferredCaseType),
          );
          responsePayload = {
            ...responsePayload,
            inferredCaseType: inferredCaseType ?? null,
            rag: {
              status: 'error',
              latencyMs: Date.now() - ragStartedAt,
              error: error instanceof Error ? error.message : String(error),
            },
          };

          log.warn(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              error: error instanceof Error ? error.message : String(error),
            },
            'RAG call failed, fallback response used',
          );
        }
      }
    }

    log.info(
      {
        requestId: correlationId,
        correlationId,
        tenantId: messageIn.tenantId,
        conversationId: conversation.id,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: nextStep,
        intentAfter: nextIntent,
        extractedText,
        extractedRawText,
        category: (responsePayload.category as string | undefined)
          ?? (nextIntent === 'consulta_laboral' ? 'laboral' : nextIntent === 'soporte' ? 'soporte' : null),
        flowMode: env.ORCH_FLOW_MODE,
        shouldReset: ai.shouldReset ?? false,
      },
      'Orchestrator decision computed',
    );

    await conversationClient.patchContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      patch,
      requestId: correlationId,
    });

    const responses: MessageOut[] = [{ type: 'text', text: responseText, payload: responsePayload }];

    responsePayload = {
      ...responsePayload,
      debug: {
        correlationId,
        extractedText,
        extractedRawText,
        category: responsePayload.category ?? null,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: nextStep,
        intentAfter: nextIntent,
        flowMode: env.ORCH_FLOW_MODE,
      },
    };

    responses[0].payload = responsePayload;

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'OUT',
      type: 'TEXT',
      text: responseText,
      payload: responsePayload,
      requestId: correlationId,
    });

    return {
      conversationId: conversation.id,
      contactId: contact.id,
      correlationId,
      responses,
    };
  },
};
