import { MessageIn } from '../dtos';
import { __testOnly_runStatefulFlow } from '../services/orchestrator.service';

type ExpectedResult = 'competent' | 'not_competent' | 'need_detail';

type Scenario = {
  id: string;
  prompt: string;
  expected: ExpectedResult;
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
    },
    {
      id: 'edge-constitucional-tutela-competent',
      prompt: 'Me negaron un medicamento y quiero presentar tutela. Es competencia del consultorio?',
      expected: 'competent',
    },
  ];

  let correct = 0;
  let wrong = 0;
  let indeterminate = 0;

  for (let i = 0; i < scenarios.length; i += 1) {
    const output = await runScenario(scenarios[i], i + 1);
    const isMatch = output.result === output.scenario.expected;

    if (output.result === 'indeterminate') {
      indeterminate += 1;
    } else if (isMatch) {
      correct += 1;
    } else {
      wrong += 1;
    }

    const status = isMatch ? 'OK' : output.result === 'indeterminate' ? 'INDETERMINATE' : 'FAIL';
    console.log(`[${status}] ${output.scenario.id}`);
    console.log(`  expected: ${output.scenario.expected}`);
    console.log(`  got: ${output.result}`);
    console.log(`  response: ${output.responseText.replace(/\s+/g, ' ').trim()}`);
  }

  const determinate = correct + wrong;
  const determinateCoverage = scenarios.length > 0
    ? Number(((determinate / scenarios.length) * 100).toFixed(2))
    : 0;
  const determinateErrorRate = determinate > 0
    ? Number(((wrong / determinate) * 100).toFixed(2))
    : 0;

  console.log('');
  console.log('Competence evaluation summary');
  console.log(`- total: ${scenarios.length}`);
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
