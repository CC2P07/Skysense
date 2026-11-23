const campos = ["temperatura", "umidade", "pressao", "qualidade_ar", "luminosidade"];
const unidades = { temperatura: "°C", umidade: "%", pressao: "hPa", qualidade_ar: "ADC", luminosidade: "ADC" };
const nomes = { temperatura: "Temperatura", umidade: "Umidade", pressao: "Pressão", qualidade_ar: "Leitura do ar", luminosidade: "Luz ambiente" };
let leituras = [];
let conectado = false;
let modoExemplo = false;
let temporizador = null;
let controlador = null;
let numeroConexao = 0;
let enderecoAtivo = "";
let intervaloAtivo = 5000;

function elemento(id) {
    return document.getElementById(id);
}

function formatarNumero(valor, casas = 1) {
    if (valor === null || valor === undefined) return "—";
    return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function formatarHora(data) {
    return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Uma leitura ausente continua vazia; não é convertida em zero.
function validarLeitura(resposta, agora = new Date()) {
    if (!resposta || typeof resposta !== "object" || Array.isArray(resposta)) {
        throw new Error("A resposta precisa ser um objeto JSON com as leituras dos sensores.");
    }
    const dados = {};
    for (const campo of campos) {
        const valor = resposta[campo];
        if (valor === null || valor === undefined) {
            dados[campo] = null;
            continue;
        }
        if (typeof valor !== "number" || !Number.isFinite(valor) || Math.abs(valor) > 1000000) {
            throw new Error("O campo " + campo + " precisa conter um número válido ou null.");
        }
        if (campo === "umidade" && (valor < 0 || valor > 100)) {
            throw new Error("A umidade deve estar entre 0 e 100.");
        }
        if (campo === "pressao" && valor <= 0) {
            throw new Error("A pressão deve ser positiva e estar em hPa.");
        }
        if ((campo === "qualidade_ar" || campo === "luminosidade") && (!Number.isInteger(valor) || valor < 0 || valor > 4095)) {
            throw new Error("As leituras ADC devem ser números inteiros entre 0 e 4095.");
        }
        dados[campo] = valor;
    }
    if (resposta.chuva !== undefined && resposta.chuva !== null && typeof resposta.chuva !== "boolean") {
        throw new Error("O campo chuva precisa conter true, false ou null.");
    }
    dados.chuva = resposta.chuva ?? null;
    if (!campos.some(campo => dados[campo] !== null) && dados.chuva === null) {
        throw new Error("A resposta ainda não contém nenhuma leitura válida.");
    }
    dados.horarioInformado = resposta.timestamp !== undefined && resposta.timestamp !== null;
    dados.horario = new Date(agora);
    if (dados.horarioInformado) {
        if (typeof resposta.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(resposta.timestamp)) {
            throw new Error("O timestamp deve ser uma data ISO com fuso horário, como 2026-10-29T12:00:00Z.");
        }
        dados.horario = new Date(resposta.timestamp);
        if (!Number.isFinite(dados.horario.getTime()) || dados.horario.getTime() > agora.getTime() + 300000) {
            throw new Error("O horário recebido é inválido ou está adiantado. Confira o relógio da estação.");
        }
    }
    dados.exemplo = resposta.exemplo === true;
    return dados;
}

function leituraAntiga(leitura, intervalo, agora = Date.now()) {
    return leitura.horarioInformado && agora - leitura.horario.getTime() > Math.max(60000, intervalo * 3);
}

function definirStatus(texto, classe = "") {
    elemento("status-conexao").textContent = texto;
    elemento("status-conexao").className = "status " + classe;
    elemento("situacao-inicio").textContent = texto;
}

function mostrarErro(mensagem = "") {
    elemento("aviso-erro").textContent = mensagem;
    elemento("aviso-erro").hidden = !mensagem;
}

function pararConsultas() {
    conectado = false;
    numeroConexao++;
    clearTimeout(temporizador);
    if (controlador) controlador.abort();
    controlador = null;
    elemento("atualizar").disabled = true;
    elemento("desconectar").disabled = true;
}

function iniciarConexao(evento) {
    evento.preventDefault();
    let endereco;
    try {
        endereco = new URL(elemento("endereco").value.trim());
        if (!["http:", "https:"].includes(endereco.protocol) || endereco.username || endereco.password) {
            throw new Error("Informe um endereço HTTP ou HTTPS, sem usuário e senha na URL.");
        }
        if (window.location.protocol === "https:" && endereco.protocol === "http:") {
            throw new Error("Esta página usa HTTPS. Use uma API HTTPS ou execute o projeto localmente por HTTP na rede da ESP32.");
        }
    } catch (erro) {
        mostrarErro(erro instanceof TypeError ? "Confira o endereço dos dados da estação." : erro.message);
        return;
    }
    pararConsultas();
    enderecoAtivo = endereco.href;
    intervaloAtivo = Number(elemento("intervalo").value);
    if (![5000, 10000, 30000].includes(intervaloAtivo)) intervaloAtivo = 5000;
    modoExemplo = false;
    leituras = [];
    atualizarInterface();
    mostrarErro();
    definirStatus("Conectando…");
    elemento("nota-inicio").textContent = "Buscando a primeira leitura da estação.";
    conectado = true;
    elemento("desconectar").disabled = false;
    try {
        localStorage.setItem("skysense-conexao", JSON.stringify({ endereco: enderecoAtivo, intervalo: intervaloAtivo }));
    } catch (erro) {
        // A conexão também funciona quando o navegador não permite salvar preferências.
    }
    buscarDados();
}

async function buscarDados() {
    if (!conectado || controlador) return;
    clearTimeout(temporizador);
    const conexaoAtual = numeroConexao;
    const controleAtual = new AbortController();
    controlador = controleAtual;
    const limite = setTimeout(() => controleAtual.abort(), 8000);
    elemento("atualizar").disabled = true;
    try {
        const resposta = await fetch(enderecoAtivo, { signal: controleAtual.signal, cache: "no-store", credentials: "omit" });
        if (!resposta.ok) throw new Error("A estação respondeu com erro HTTP " + resposta.status + ".");
        let json;
        try {
            json = await resposta.json();
        } catch (erro) {
            if (erro.name === "AbortError") throw erro;
            throw new Error("O endereço respondeu, mas o conteúdo não é um JSON válido.");
        }
        if (conexaoAtual !== numeroConexao) return;
        const leitura = validarLeitura(json);
        if (leitura.exemplo !== modoExemplo) leituras = [];
        modoExemplo = leitura.exemplo;
        const anterior = leituras[leituras.length - 1];
        if (anterior && leitura.horario < anterior.horario) {
            throw new Error("O horário recebido é anterior ao da última leitura. Confira o relógio da estação.");
        }
        // Respostas repetidas com o mesmo horário não viram novas medições no gráfico.
        if (anterior && leitura.horario.getTime() === anterior.horario.getTime()) leituras[leituras.length - 1] = leitura;
        else leituras.push(leitura);
        if (leituras.length > 120) leituras.shift();
        atualizarInterface();
        if (modoExemplo) {
            definirStatus("Dados de exemplo", "exemplo");
            mostrarErro();
        } else if (leituraAntiga(leitura, intervaloAtivo)) {
            definirStatus("Dados desatualizados", "erro");
            elemento("medidas").classList.add("desatualizado");
            mostrarErro("O endereço está respondendo, mas o horário da última leitura é antigo. Confira a coleta e o relógio da estação.");
        } else {
            definirStatus("Estação conectada", "conectado");
            mostrarErro();
        }
    } catch (erro) {
        if (conexaoAtual !== numeroConexao) return;
        definirStatus("Sem resposta", "erro");
        elemento("medidas").classList.add("desatualizado");
        elemento("nota-inicio").textContent = leituras.length ? "Última leitura recebida. A estação está sem resposta." : "Nenhuma leitura recebida da estação.";
        let mensagem = erro.message;
        if (erro.name === "AbortError") mensagem = "A estação demorou mais de 8 segundos para responder.";
        if (erro instanceof TypeError) mensagem = "Não foi possível acessar a estação. Confira o endereço, a rede e a permissão CORS do servidor.";
        mostrarErro(mensagem + " Uma nova tentativa será feita automaticamente.");
    } finally {
        clearTimeout(limite);
        if (conexaoAtual === numeroConexao) {
            controlador = null;
            elemento("atualizar").disabled = !conectado;
            if (conectado) temporizador = setTimeout(buscarDados, intervaloAtivo);
        }
    }
}

function desconectar() {
    pararConsultas();
    mostrarErro();
    // A demonstração é descartada ao sair, para não se misturar às leituras reais.
    if (modoExemplo) {
        modoExemplo = false;
        leituras = [];
    }
    atualizarInterface();
    definirStatus("Desconectado");
    elemento("medidas").classList.add("desatualizado");
    elemento("nota-inicio").textContent = leituras.length ? "Última leitura recebida antes de desconectar." : "As leituras aparecem após a conexão com a estação.";
}

function verExemplo() {
    if (modoExemplo) {
        desconectar();
        return;
    }
    pararConsultas();
    mostrarErro();
    modoExemplo = true;
    const temperaturas = [23.8, 23.9, 24.1, 24.0, 24.2, 24.4, 24.3, 24.6, 24.5, 24.7, 24.6, 24.5];
    const umidades = [65, 65, 64, 64, 63, 63, 64, 62, 63, 62, 62, 62];
    const agora = Date.now();
    leituras = temperaturas.map((temperatura, indice) => validarLeitura({
        temperatura,
        umidade: umidades[indice],
        pressao: 1013.2 + (indice % 3) * 0.1,
        qualidade_ar: 1380 + (indice % 4) * 7,
        luminosidade: 2100 + (indice % 5) * 40,
        chuva: false,
        timestamp: new Date(agora - (temperaturas.length - 1 - indice) * 5000).toISOString(),
        exemplo: true
    }));
    atualizarInterface();
    definirStatus("Dados de exemplo", "exemplo");
    elemento("desconectar").disabled = false;
}

function atualizarInterface() {
    const atual = leituras[leituras.length - 1];
    elemento("medidas").classList.remove("desatualizado");
    for (const campo of campos) {
        const casas = campo === "qualidade_ar" || campo === "luminosidade" ? 0 : 1;
        elemento(campo.replace("_", "-")).textContent = formatarNumero(atual ? atual[campo] : null, casas);
    }
    elemento("temperatura-inicio").textContent = formatarNumero(atual ? atual.temperatura : null);
    elemento("chuva").textContent = !atual || atual.chuva === null ? "—" : atual.chuva ? "Detectada" : "Sem chuva";
    elemento("aviso-exemplo").hidden = !modoExemplo;
    elemento("ver-exemplo").textContent = modoExemplo ? "Sair dos dados de exemplo" : "Ver dados de exemplo →";
    elemento("exportar").disabled = !leituras.length;
    elemento("exportar").textContent = modoExemplo ? "Baixar CSV de exemplo ↓" : "Baixar CSV ↓";
    elemento("ultima-atualizacao").textContent = atual ? (modoExemplo ? "Exemplo · " : atual.horarioInformado ? "Última leitura · " : "Recebida em · ") + atual.horario.toLocaleString("pt-BR") : "Nenhuma leitura recebida.";
    elemento("nota-inicio").textContent = modoExemplo ? "Dados de exemplo · sem conexão com a estação." : atual ? "Última leitura às " + formatarHora(atual.horario) + "." : "As leituras aparecem após a conexão com a estação.";
    elemento("resumo-leituras").textContent = leituras.length ? Math.min(8, leituras.length) + " de " + leituras.length + " leituras da sessão" + (modoExemplo ? " · dados de exemplo." : ".") : "O histórico será preenchido após o recebimento dos dados.";
    desenharGrafico();
    preencherTabela();
}

function desenharGrafico() {
    const campo = elemento("tipo-grafico").value;
    const validas = leituras.filter(leitura => leitura[campo] !== null);
    const grupo = elemento("serie-grafico");
    grupo.replaceChildren();
    elemento("grafico").toggleAttribute("hidden", !validas.length);
    elemento("grafico-vazio").hidden = !!validas.length;
    for (const id of ["valor-minimo", "valor-medio", "valor-maximo"]) elemento(id).textContent = "—";
    if (!validas.length) return;
    const valores = validas.map(leitura => leitura[campo]);
    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);
    const media = valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
    const casas = campo === "qualidade_ar" || campo === "luminosidade" ? 0 : 1;
    elemento("valor-minimo").textContent = formatarNumero(minimo, casas) + " " + unidades[campo];
    elemento("valor-medio").textContent = formatarNumero(media, casas) + " " + unidades[campo];
    elemento("valor-maximo").textContent = formatarNumero(maximo, casas) + " " + unidades[campo];
    const margem = Math.max((maximo - minimo) * 0.15, 0.5);
    const base = minimo - margem;
    const topo = maximo + margem;
    elemento("escala-maxima").textContent = formatarNumero(topo, casas);
    elemento("escala-media").textContent = formatarNumero((topo + base) / 2, casas);
    elemento("escala-minima").textContent = formatarNumero(base, casas);
    elemento("hora-inicio").textContent = formatarHora(leituras[0].horario);
    elemento("hora-fim").textContent = formatarHora(leituras[leituras.length - 1].horario);
    const inicio = leituras[0].horario.getTime();
    const duracao = leituras[leituras.length - 1].horario.getTime() - inicio;
    let caminho = "";
    let trechoNovo = true;
    let ultimoPonto;
    // Uma lacuna no sensor interrompe a linha, em vez de inventar uma leitura.
    for (const leitura of leituras) {
        if (leitura[campo] === null) { trechoNovo = true; continue; }
        const x = duracao ? 55 + ((leitura.horario.getTime() - inicio) / duracao) * 565 : 337;
        const y = 185 - ((leitura[campo] - base) / (topo - base)) * 160;
        caminho += (trechoNovo ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
        trechoNovo = false;
        ultimoPonto = { x, y };
    }
    const linha = document.createElementNS("http://www.w3.org/2000/svg", "path");
    linha.setAttribute("d", caminho);
    linha.setAttribute("class", "linha-grafico");
    grupo.appendChild(linha);
    const ponto = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ponto.setAttribute("cx", ultimoPonto.x);
    ponto.setAttribute("cy", ultimoPonto.y);
    ponto.setAttribute("r", 4);
    ponto.setAttribute("class", "ponto-grafico");
    grupo.appendChild(ponto);
    elemento("grafico").setAttribute("aria-label", nomes[campo] + ": " + validas.length + " leituras. Mínima " + formatarNumero(minimo, casas) + ", máxima " + formatarNumero(maximo, casas) + " " + unidades[campo] + (modoExemplo ? ". Dados de exemplo." : "."));
}

function preencherTabela() {
    const tabela = elemento("tabela-leituras");
    tabela.replaceChildren();
    if (!leituras.length) {
        const linha = tabela.insertRow();
        const celula = linha.insertCell();
        celula.colSpan = 7;
        celula.className = "tabela-vazia";
        celula.textContent = "Aguardando a primeira leitura da estação.";
        return;
    }
    for (const leitura of leituras.slice(-8).reverse()) {
        const valores = [formatarHora(leitura.horario), formatarNumero(leitura.temperatura), formatarNumero(leitura.umidade), formatarNumero(leitura.pressao), formatarNumero(leitura.qualidade_ar, 0), formatarNumero(leitura.luminosidade, 0), leitura.chuva === null ? "—" : leitura.chuva ? "Detectada" : "Sem chuva"];
        const linha = tabela.insertRow();
        for (const valor of valores) linha.insertCell().textContent = valor;
    }
}

function montarCSV(lista) {
    const linhas = [["origem", "horario_iso", "temperatura_c", "umidade_percentual", "pressao_hpa", "ar_adc", "luz_adc", "chuva"]];
    for (const leitura of lista) {
        linhas.push([leitura.exemplo ? "exemplo" : "esp32", leitura.horario.toISOString(), ...campos.map(campo => leitura[campo] === null ? "" : String(leitura[campo]).replace(".", ",")), leitura.chuva === null ? "" : String(leitura.chuva)]);
    }
    return "\uFEFF" + linhas.map(linha => linha.map(valor => '"' + valor.replaceAll('"', '""') + '"').join(";")).join("\r\n");
}

function exportarCSV() {
    if (!leituras.length) return;
    const arquivo = new Blob([montarCSV(leituras)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");
    link.href = url;
    link.download = modoExemplo ? "skysense-exemplo.csv" : "skysense-leituras.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function iniciarPagina() {
    elemento("ano").textContent = new Date().getFullYear();
    const menu = elemento("menu");
    const botaoMenu = elemento("menu-toggle");
    botaoMenu.addEventListener("click", () => {
        const aberto = menu.classList.toggle("aberto");
        botaoMenu.setAttribute("aria-expanded", String(aberto));
        botaoMenu.textContent = aberto ? "Fechar" : "Menu";
    });
    function fecharMenu() {
        menu.classList.remove("aberto");
        botaoMenu.setAttribute("aria-expanded", "false");
        botaoMenu.textContent = "Menu";
    }
    menu.querySelectorAll("a").forEach(link => link.addEventListener("click", fecharMenu));
    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && menu.classList.contains("aberto")) {
            fecharMenu();
            botaoMenu.focus();
        }
    });
    try {
        const salvo = JSON.parse(localStorage.getItem("skysense-conexao"));
        if (salvo && typeof salvo.endereco === "string") elemento("endereco").value = salvo.endereco;
        if (salvo && [5000, 10000, 30000].includes(salvo.intervalo)) elemento("intervalo").value = String(salvo.intervalo);
    } catch (erro) {
        // Preferências antigas não impedem o carregamento do painel.
    }
    elemento("form-conexao").addEventListener("submit", iniciarConexao);
    elemento("desconectar").addEventListener("click", desconectar);
    elemento("ver-exemplo").addEventListener("click", verExemplo);
    elemento("atualizar").addEventListener("click", buscarDados);
    elemento("tipo-grafico").addEventListener("change", desenharGrafico);
    elemento("exportar").addEventListener("click", exportarCSV);
}

document.addEventListener("DOMContentLoaded", iniciarPagina);
