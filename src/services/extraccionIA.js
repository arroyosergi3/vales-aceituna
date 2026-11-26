// Lectura del vale con Gemini (API de Google, con plan gratuito).
// Llama directamente a la API REST con fetch: no necesita ninguna dependencia nueva.

const MODELO = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const URL_API = (modelo) => `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

const falloIA = (mensaje, status = 502) => Object.assign(new Error(mensaje), { status });

const PROMPT_SISTEMA = `Eres un asistente que lee vales de entrega de aceituna (almazara o cooperativa).
Extrae únicamente lo que se vea en la foto del vale.
Reglas:
- Si un dato no aparece o no se lee con seguridad, devuelve null. No lo inventes ni lo deduzcas.
- La fecha va en formato YYYY-MM-DD. Si el año no aparece, devuelve null.
- Los kilos van como número, sin unidades y con punto decimal. Si el peso está en toneladas, conviértelo a kilos.
- Si hay peso bruto, tara y neto, kg es el peso NETO de aceituna.
- propietario es la persona o entidad que entrega la aceituna.
- parcela es el nombre, número o referencia de la finca/parcela.
- rendimiento es el porcentaje de rendimiento graso, solo si aparece.
- En observaciones pon solo notas relevantes escritas en el vale; si no hay, null.`;

// Esquema de la respuesta: Gemini devuelve siempre este JSON; lo que no se vea llega como null
const campo = (type) => ({ type, nullable: true });
const ESQUEMA = {
  type: 'object',
  properties: {
    numero_vale: campo('string'),
    fecha: campo('string'),
    kg: campo('number'),
    parcela: campo('string'),
    propietario: campo('string'),
    variedad: campo('string'),
    rendimiento: campo('number'),
    observaciones: campo('string'),
  },
  required: ['numero_vale', 'fecha', 'kg', 'parcela', 'propietario', 'variedad', 'rendimiento', 'observaciones'],
};

async function extraerDatosVale(buffer, mimetype) {
  if (!process.env.GEMINI_API_KEY) {
    throw falloIA('Falta GEMINI_API_KEY en las variables de entorno', 500);
  }

  let respuesta;
  try {
    respuesta = await fetch(URL_API(MODELO), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT_SISTEMA }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Extrae los datos de este vale.' },
              { inline_data: { mime_type: mimetype, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA },
      }),
    });
  } catch (e) {
    throw falloIA(e.name === 'TimeoutError' ? 'Gemini tardó demasiado en responder' : 'No se pudo conectar con Gemini', 504);
  }

  if (!respuesta.ok) {
    const detalle = (await respuesta.json().catch(() => ({})))?.error?.message || '';
    console.error(`Gemini ${respuesta.status}: ${detalle}`);
    if (respuesta.status === 429) throw falloIA('Se ha agotado el cupo gratuito de Gemini. Inténtalo más tarde o rellena el vale a mano', 429);
    if (respuesta.status === 400 || respuesta.status === 403) throw falloIA('Gemini ha rechazado la petición. Revisa GEMINI_API_KEY y el modelo configurado', 502);
    throw falloIA('Gemini no está disponible ahora mismo', 502);
  }

  const datos = await respuesta.json();
  const texto = datos.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!texto) {
    const motivo = datos.promptFeedback?.blockReason || datos.candidates?.[0]?.finishReason || 'sin respuesta';
    throw falloIA(`Gemini no ha podido leer el vale (${motivo})`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw falloIA('Gemini devolvió una respuesta que no se puede interpretar');
  }
}

module.exports = { extraerDatosVale };
