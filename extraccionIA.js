const OpenAI = require('openai');

const MODELO = process.env.OPENAI_MODEL || 'gpt-4o';

// Cliente creado al primer uso, para que el servidor arranque aunque falte la clave
let cliente;
const getCliente = () => {
  if (!process.env.OPENAI_API_KEY) {
    const e = new Error('Falta OPENAI_API_KEY en el archivo .env');
    e.status = 500;
    throw e;
  }
  return (cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
};

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

// Esquema "strict": todos los campos son obligatorios, los que no se vean llegan como null
const nullable = (tipo) => ({ type: [tipo, 'null'] });
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['numero_vale', 'fecha', 'kg', 'parcela', 'propietario', 'variedad', 'rendimiento', 'observaciones'],
  properties: {
    numero_vale: nullable('string'),
    fecha: nullable('string'),
    kg: nullable('number'),
    parcela: nullable('string'),
    propietario: nullable('string'),
    variedad: nullable('string'),
    rendimiento: nullable('number'),
    observaciones: nullable('string'),
  },
};

async function extraerDatosVale(buffer, mimetype) {
  const imagenBase64 = buffer.toString('base64');

  const respuesta = await getCliente().chat.completions.create({
    model: MODELO,
    temperature: 0,
    messages: [
      { role: 'system', content: PROMPT_SISTEMA },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extrae los datos de este vale.' },
          { type: 'image_url', image_url: { url: `data:${mimetype};base64,${imagenBase64}`, detail: 'high' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'vale_aceituna', strict: true, schema: ESQUEMA },
    },
  });

  const texto = respuesta.choices[0]?.message?.content;
  if (!texto) throw new Error('La IA no devolvió ningún resultado');
  return JSON.parse(texto);
}

module.exports = { extraerDatosVale };
