import { MessageIn } from '../dtos';
import { __testOnly_runStatefulFlow } from '../services/orchestrator.service';

type ExpectedResult = 'competent' | 'not_competent' | 'need_detail';

type Scenario = {
  id: string;
  prompt: string;
  expected: ExpectedResult;
  shouldHideAppointments?: boolean;
};

function buildMessage(externalUserId: string, text: string): MessageIn {
  return {
    tenantId: 'tenant_test',
    channel: 'webchat',
    externalUserId,
    message: {
      type: 'text',
      message: text,
    } as any,
  };
}

async function sendMessage(input: {
  externalUserId: string;
  conversationId: string;
  correlationId: string;
  text: string;
}) {
  return __testOnly_runStatefulFlow({
    messageIn: buildMessage(input.externalUserId, input.text),
    conversationId: input.conversationId,
    correlationId: input.correlationId,
  });
}

async function bootstrapConversation(externalUserId: string, conversationId: string): Promise<void> {
  await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-hello`,
    text: 'hola',
  });

  await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-consent`,
    text: 'si autorizo',
  });
}

function classifyResult(responseText: string, payload: Record<string, unknown>): ExpectedResult | 'indeterminate' {
  const competenceGate = typeof payload.competenceGate === 'string' ? payload.competenceGate : '';
  const normalized = responseText.toLowerCase();

  if (competenceGate === 'blocked_not_competent' || normalized.includes('no puede ser tramitado por el consultorio juridico')) {
    return 'not_competent';
  }

  if (competenceGate === 'allowed_competent' || normalized.includes('si puede ser orientado por el consultorio juridico')) {
    return 'competent';
  }

  if (competenceGate === 'need_more_detail' || normalized.includes('faltan datos para confirmar competencia')) {
    return 'need_detail';
  }

  return 'indeterminate';
}

async function runScenario(scenario: Scenario, index: number): Promise<{
  scenario: Scenario;
  result: ExpectedResult | 'indeterminate';
  responseText: string;
  appointmentHintsVisible: boolean;
}> {
  const conversationId = `competence-${Date.now()}-${index}`;
  const externalUserId = `competence-user-${index}-${Date.now()}`;

  await bootstrapConversation(externalUserId, conversationId);

  const response = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-prompt`,
    text: scenario.prompt,
  });

  return {
    scenario,
    result: classifyResult(response.responseText, response.payload),
    responseText: response.responseText,
    appointmentHintsVisible: /si, deseo agendar una cita|reprogramar cita|cancelar cita/i.test(response.responseText),
  };
}

async function runLockedAreaRegression(index: number): Promise<{ ok: boolean; details: string[] }> {
  const conversationId = `locked-area-${Date.now()}-${index}`;
  const externalUserId = `locked-area-user-${Date.now()}-${index}`;
  const details: string[] = [];

  await bootstrapConversation(externalUserId, conversationId);

  const blocked = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-blocked`,
    text: 'es un divorcio civil',
  });

  const pickOption = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-pick-option`,
    text: '1',
  });

  const followup = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-followup`,
    text: 'quiero liquidar 50 salarios',
  });

  const blockedOk = /no puede ser tramitado por el consultorio juridico/i.test(blocked.responseText);
  const optionOk = /este asunto si esta dentro de nuestra competencia/i.test(pickOption.responseText);
  const noLaboralLabel = !/tipo de caso:\s*laboral/i.test(followup.responseText);

  details.push(`blocked_ok=${blockedOk ? 'yes' : 'no'}`);
  details.push(`option_ok=${optionOk ? 'yes' : 'no'}`);
  details.push(`no_laboral_label_after_lock=${noLaboralLabel ? 'yes' : 'no'}`);

  return {
    ok: blockedOk && optionOk && noLaboralLabel,
    details,
  };
}

async function runDivorcePersistenceRegression(index: number): Promise<{ ok: boolean; details: string[] }> {
  const conversationId = `divorce-persist-${Date.now()}-${index}`;
  const externalUserId = `divorce-persist-user-${Date.now()}-${index}`;
  const details: string[] = [];

  await bootstrapConversation(externalUserId, conversationId);

  const blocked = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-blocked`,
    text: 'me quiero divorciar',
  });

  const followup = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-followup`,
    text: 'pero es por civil',
  });

  const blockedOk = /no puede ser tramitado por el consultorio juridico/i.test(blocked.responseText);
  const stillBlockedOk = /no puede ser tramitado por el consultorio juridico|elige un numero de la lista/i.test(followup.responseText);
  const noOrientationAfterFollowup = !/orientacion preliminar/i.test(followup.responseText);
  const noAppointmentHints = !/si, deseo agendar una cita|reprogramar cita|cancelar cita/i.test(followup.responseText);

  details.push(`blocked_ok=${blockedOk ? 'yes' : 'no'}`);
  details.push(`followup_still_blocked=${stillBlockedOk ? 'yes' : 'no'}`);
  details.push(`no_orientation_after_followup=${noOrientationAfterFollowup ? 'yes' : 'no'}`);
  details.push(`no_appointment_hints=${noAppointmentHints ? 'yes' : 'no'}`);

  return {
    ok: blockedOk && stillBlockedOk && noOrientationAfterFollowup && noAppointmentHints,
    details,
  };
}

async function runFamilyLiquidationGuidanceRegression(index: number): Promise<{ ok: boolean; details: string[] }> {
  const conversationId = `family-liquidation-${Date.now()}-${index}`;
  const externalUserId = `family-liquidation-user-${Date.now()}-${index}`;
  const details: string[] = [];

  await bootstrapConversation(externalUserId, conversationId);

  const direct = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-direct`,
    text: 'Quiero liquidar las sociedades con activos hasta 70 SMLV, es competencia del consultorio?',
  });

  const familyAreaMention = /area de \*familia\*|asunto parece de \*familia\*/i.test(direct.responseText);
  const noDivorceQuestionPattern = !/el divorcio seria de mutuo acuerdo/i.test(direct.responseText);
  const avoidsCommercialMisroute = !/area de \*comercial\*/i.test(direct.responseText);

  details.push(`family_area_mention=${familyAreaMention ? 'yes' : 'no'}`);
  details.push(`avoids_divorce_question_pattern=${noDivorceQuestionPattern ? 'yes' : 'no'}`);
  details.push(`avoids_commercial_misroute=${avoidsCommercialMisroute ? 'yes' : 'no'}`);
  details.push(`response_sample=${direct.responseText.replace(/\s+/g, ' ').trim().slice(0, 220)}`);

  return {
    ok: familyAreaMention && noDivorceQuestionPattern && avoidsCommercialMisroute,
    details,
  };
}

async function runNotCompetentResetHintRegression(index: number): Promise<{ ok: boolean; details: string[] }> {
  const conversationId = `not-competent-reset-${Date.now()}-${index}`;
  const externalUserId = `not-competent-reset-user-${Date.now()}-${index}`;
  const details: string[] = [];

  await bootstrapConversation(externalUserId, conversationId);

  const blocked = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-blocked`,
    text: 'necesito divorcio civil',
  });

  const includesResetHint = /si ninguna opcion te sirve, escribe \*reset\*/i.test(blocked.responseText);
  details.push(`includes_reset_hint=${includesResetHint ? 'yes' : 'no'}`);

  return {
    ok: includesResetHint,
    details,
  };
}

async function runCompetentAppointmentAvailabilityRegression(index: number): Promise<{ ok: boolean; details: string[] }> {
  const conversationId = `competent-appointment-${Date.now()}-${index}`;
  const externalUserId = `competent-appointment-user-${Date.now()}-${index}`;
  const details: string[] = [];

  await bootstrapConversation(externalUserId, conversationId);

  const blocked = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-blocked`,
    text: 'es un divorcio civil',
  });

  const selectCompetent = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-select`,
    text: '1',
  });

  const competentDecisionWithoutAppointment = /este asunto si esta dentro de nuestra competencia/i.test(selectCompetent.responseText)
    && !/si, deseo agendar una cita/i.test(selectCompetent.responseText);

  const orientation = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-orientation`,
    text: 'quiero liquidaciones de sociedades con activos hasta 70 SMLV',
  });

  const canSeeAppointmentOption = /si, deseo agendar una cita/i.test(orientation.responseText);
  const isOrientationCard = /que deseas hacer ahora\?/i.test(orientation.responseText);

  const startAppointment = await sendMessage({
    externalUserId,
    conversationId,
    correlationId: `${conversationId}-start-appointment`,
    text: 'si, deseo agendar una cita',
  });

  const startsDataCollection = /antes de agendar la cita te pido unos datos rapidos|empecemos con tu nombre completo/i.test(startAppointment.responseText);

  details.push(`blocked_initially=${/no puede ser tramitado por el consultorio juridico/i.test(blocked.responseText) ? 'yes' : 'no'}`);
  details.push(`competent_decision_without_appointment=${competentDecisionWithoutAppointment ? 'yes' : 'no'}`);
  details.push(`orientation_card_detected=${isOrientationCard ? 'yes' : 'no'}`);
  details.push(`can_see_appointment_option=${canSeeAppointmentOption ? 'yes' : 'no'}`);
  details.push(`can_start_appointment_flow=${startsDataCollection ? 'yes' : 'no'}`);

  return {
    ok: competentDecisionWithoutAppointment && (!isOrientationCard || canSeeAppointmentOption) && startsDataCollection,
    details,
  };
}

async function run(): Promise<void> {
  const scenarios: Scenario[] = [
    {
      id: 'laboral-competent',
      prompt: 'Me despidieron sin justa causa y no me pagaron liquidacion. Es competencia del consultorio?',
      expected: 'competent',
    },
    {
      id: 'penal-competent',
      prompt: 'Fui victima de lesiones y ya denuncie en fiscalia. Si es competencia?',
      expected: 'competent',
    },
    {
      id: 'penal-not-competent',
      prompt: 'Es un proceso penal ante juez penal especializado. Lo tramita el consultorio?',
      expected: 'not_competent',
    },
    {
      id: 'civil-competent',
      prompt: 'Tengo un caso civil de arrendamiento de 20 SMLV ante juez civil municipal. Es competencia?',
      expected: 'competent',
    },
    {
      id: 'civil-not-competent',
      prompt: 'Es un caso civil de compraventa por 120 SMLV. Es de competencia?',
      expected: 'not_competent',
    },
    {
      id: 'familia-competent',
      prompt: 'Es tema de cuota de alimentos en comisaria de familia. Si lo atiende el consultorio?',
      expected: 'competent',
    },
    {
      id: 'familia-not-competent',
      prompt: 'Necesito divorcio y quiero saber si es competencia del consultorio.',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'familia-divorcio-civil-not-competent',
      prompt: 'Necesito divorcio civil.',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'hardblock-divorcio-verbal-not-competent',
      prompt: 'Me quiero divorciar',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'comercial-competent',
      prompt: 'Tengo un reclamo de proteccion al consumidor por garantia. Me pueden ayudar?',
      expected: 'competent',
    },
    {
      id: 'comercial-not-competent',
      prompt: 'Es un asunto de constitucion de sociedad en camara de comercio. Es atendible?',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'conciliacion-competent',
      prompt: 'Quiero conciliacion por incumplimiento de contrato y pagare. Si lo tramita el consultorio?',
      expected: 'competent',
    },
    {
      id: 'constitucional-competent',
      prompt: 'Necesito interponer tutela por vulneracion de derechos. Es competencia del consultorio?',
      expected: 'competent',
    },
    {
      id: 'unknown-needs-detail',
      prompt: 'No tengo claro el area, solo quiero saber si es competencia de ustedes.',
      expected: 'need_detail',
      shouldHideAppointments: true,
    },
    {
      id: 'edge-laboral-coloquial-competent',
      prompt: 'Me echaron del trabajo y no me pagaron prestaciones. Ustedes me pueden ayudar?',
      expected: 'competent',
    },
    {
      id: 'edge-penal-coloquial-competent',
      prompt: 'Me robaron y ya puse denuncia en fiscalia. Lo atiende el consultorio?',
      expected: 'competent',
    },
    {
      id: 'edge-civil-circuito-not-competent',
      prompt: 'Tengo proceso ante juez civil del circuito por incumplimiento de contrato. Es competencia?',
      expected: 'not_competent',
    },
    {
      id: 'edge-familia-union-marital-not-competent',
      prompt: 'Quiero declaracion de union marital de hecho. Si es competencia?',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'edge-conciliacion-letra-competent',
      prompt: 'Quiero conciliacion por una letra de cambio. Es competencia del consultorio?',
      expected: 'competent',
    },
    {
      id: 'edge-comercial-consumidor-competent',
      prompt: 'Compre un producto defectuoso y quiero proteccion al consumidor. Es atendible?',
      expected: 'competent',
    },
    {
      id: 'edge-comercial-societario-not-competent',
      prompt: 'Necesito asesoria para fusion de sociedades. Es de competencia?',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
    {
      id: 'edge-constitucional-tutela-competent',
      prompt: 'Me negaron un medicamento y quiero presentar tutela. Es competencia del consultorio?',
      expected: 'competent',
    },
    {
      id: 'hardblock-penal-extradicion-not-competent',
      prompt: 'Tengo un proceso de extradicion. Es competencia del consultorio?',
      expected: 'not_competent',
      shouldHideAppointments: true,
    },
  ];

  let correct = 0;
  let wrong = 0;
  let indeterminate = 0;

  for (let i = 0; i < scenarios.length; i += 1) {
    const output = await runScenario(scenarios[i], i + 1);
    const isMatch = output.result === output.scenario.expected;
    const expectedHideAppointments = output.scenario.shouldHideAppointments ?? false;
    const appointmentVisibilityMismatch = expectedHideAppointments && output.appointmentHintsVisible;

    if (output.result === 'indeterminate') {
      indeterminate += 1;
    } else if (isMatch && !appointmentVisibilityMismatch) {
      correct += 1;
    } else {
      wrong += 1;
    }

    const status = output.result === 'indeterminate'
      ? 'INDETERMINATE'
      : isMatch && !appointmentVisibilityMismatch
        ? 'OK'
        : 'FAIL';
    console.log(`[${status}] ${output.scenario.id}`);
    console.log(`  expected: ${output.scenario.expected}`);
    console.log(`  got: ${output.result}`);
    if (expectedHideAppointments) {
      console.log(`  appointment_hints_visible: ${output.appointmentHintsVisible ? 'yes' : 'no'}`);
    }
    console.log(`  response: ${output.responseText.replace(/\s+/g, ' ').trim()}`);
  }

  const lockedAreaRegression = await runLockedAreaRegression(scenarios.length + 1);
  if (lockedAreaRegression.ok) {
    correct += 1;
    console.log('[OK] locked-area-family-selection-regression');
  } else {
    wrong += 1;
    console.log('[FAIL] locked-area-family-selection-regression');
  }
  for (const detail of lockedAreaRegression.details) {
    console.log(`  ${detail}`);
  }

  const divorcePersistenceRegression = await runDivorcePersistenceRegression(scenarios.length + 2);
  if (divorcePersistenceRegression.ok) {
    correct += 1;
    console.log('[OK] divorce-noncompetence-persistence-regression');
  } else {
    wrong += 1;
    console.log('[FAIL] divorce-noncompetence-persistence-regression');
  }
  for (const detail of divorcePersistenceRegression.details) {
    console.log(`  ${detail}`);
  }

  const familyLiquidationGuidanceRegression = await runFamilyLiquidationGuidanceRegression(scenarios.length + 3);
  if (familyLiquidationGuidanceRegression.ok) {
    correct += 1;
    console.log('[OK] family-liquidation-guidance-regression');
  } else {
    wrong += 1;
    console.log('[FAIL] family-liquidation-guidance-regression');
  }
  for (const detail of familyLiquidationGuidanceRegression.details) {
    console.log(`  ${detail}`);
  }

  const notCompetentResetHintRegression = await runNotCompetentResetHintRegression(scenarios.length + 4);
  if (notCompetentResetHintRegression.ok) {
    correct += 1;
    console.log('[OK] not-competent-reset-hint-regression');
  } else {
    wrong += 1;
    console.log('[FAIL] not-competent-reset-hint-regression');
  }
  for (const detail of notCompetentResetHintRegression.details) {
    console.log(`  ${detail}`);
  }

  const competentAppointmentAvailabilityRegression = await runCompetentAppointmentAvailabilityRegression(scenarios.length + 5);
  if (competentAppointmentAvailabilityRegression.ok) {
    correct += 1;
    console.log('[OK] competent-appointment-availability-regression');
  } else {
    wrong += 1;
    console.log('[FAIL] competent-appointment-availability-regression');
  }
  for (const detail of competentAppointmentAvailabilityRegression.details) {
    console.log(`  ${detail}`);
  }

  const totalChecks = scenarios.length + 5;
  const determinate = correct + wrong;
  const determinateCoverage = totalChecks > 0
    ? Number(((determinate / totalChecks) * 100).toFixed(2))
    : 0;
  const determinateErrorRate = determinate > 0
    ? Number(((wrong / determinate) * 100).toFixed(2))
    : 0;

  console.log('');
  console.log('Competence evaluation summary');
  console.log(`- total: ${totalChecks}`);
  console.log(`- correct: ${correct}`);
  console.log(`- wrong: ${wrong}`);
  console.log(`- indeterminate: ${indeterminate}`);
  console.log(`- determinate coverage: ${determinateCoverage}%`);
  console.log(`- determinate error rate: ${determinateErrorRate}%`);

  if (wrong > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('verify-flow failed', error);
  process.exit(1);
});
