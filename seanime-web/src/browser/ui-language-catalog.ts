// First-party UI copy only; no network access or user-content translation.
export const languages = [{code:"en",label:"English"},{code:"hi",label:"हिन्दी"},{code:"es",label:"Español"}] as const
export type UiLanguage = typeof languages[number]["code"]
const messages: Record<string, {hi:string;es:string}> = {
  ...{"Current":{"hi":"अभी देख रहे हैं","es":"En curso"},"Repeating":{"hi":"दोबारा देख रहे हैं","es":"Volviendo a ver"},"Planning":{"hi":"देखने की योजना","es":"Pendientes"},"Paused":{"hi":"रोके गए","es":"En pausa"},"Completed":{"hi":"पूरे किए","es":"Completados"},"Dropped":{"hi":"छोड़े गए","es":"Abandonados"},"Aired Recently":{"hi":"हाल में प्रसारित","es":"Emitidos recientemente"},"Genre":{"hi":"शैली","es":"Género"},"All genres":{"hi":"सभी शैलियाँ","es":"Todos los géneros"},"Tags":{"hi":"टैग","es":"Etiquetas"},"All tags":{"hi":"सभी टैग","es":"Todas las etiquetas"},"Format":{"hi":"फ़ॉर्मेट","es":"Formato"},"All formats":{"hi":"सभी फ़ॉर्मेट","es":"Todos los formatos"},"All countries":{"hi":"सभी देश","es":"Todos los países"},"Season":{"hi":"सीज़न","es":"Temporada"},"All seasons":{"hi":"सभी सीज़न","es":"Todas las temporadas"},"Year":{"hi":"वर्ष","es":"Año"},"Timeless":{"hi":"सभी वर्ष","es":"Cualquier año"},"Status":{"hi":"स्थिति","es":"Estado"},"All statuses":{"hi":"सभी स्थितियाँ","es":"Todos los estados"},"All scores":{"hi":"सभी रेटिंग","es":"Todas las puntuaciones"},"Adult":{"hi":"वयस्क","es":"Adultos"},"Title":{"hi":"शीर्षक","es":"Título"}},
  "Home": {
    "hi": "होम",
    "es": "Inicio"
  },
  "Discover": {
    "hi": "खोजें",
    "es": "Descubrir"
  },
  "Search": {
    "hi": "खोज",
    "es": "Buscar"
  },
  "My List": {
    "hi": "मेरी सूची",
    "es": "Mi lista"
  },
  "Profile": {
    "hi": "प्रोफ़ाइल",
    "es": "Perfil"
  },
  "Settings": {
    "hi": "सेटिंग्स",
    "es": "Ajustes"
  },
  "Schedule": {
    "hi": "शेड्यूल",
    "es": "Calendario"
  },
  "Manga": {
    "hi": "मांगा",
    "es": "Manga"
  },
  "Anime": {
    "hi": "एनीमे",
    "es": "Anime"
  },
  "More": {
    "hi": "और",
    "es": "Más"
  },
  "Extensions": {
    "hi": "एक्सटेंशन",
    "es": "Extensiones"
  },
  "Refresh AniList": {
    "hi": "AniList रीफ़्रेश करें",
    "es": "Actualizar AniList"
  },
  "Mobile navigation": {
    "hi": "मोबाइल नेविगेशन",
    "es": "Navegación móvil"
  },
  "AniDash Go settings": {
    "hi": "AniDash Go सेटिंग्स",
    "es": "Ajustes de AniDash Go"
  },
  "Your account, streaming, library and preferences.": {
    "hi": "आपका खाता, स्ट्रीमिंग, लाइब्रेरी और प्राथमिकताएँ।",
    "es": "Tu cuenta, streaming, biblioteca y preferencias."
  },
  "Interface language": {
    "hi": "इंटरफ़ेस भाषा",
    "es": "Idioma de la interfaz"
  },
  "Language": {
    "hi": "भाषा",
    "es": "Idioma"
  },
  "Choose your display language. This setting stays on this device. Some content remains in its original language.": {
    "hi": "प्रदर्शन की भाषा चुनें। यह सेटिंग इसी डिवाइस पर रहती है। कुछ सामग्री मूल भाषा में रहती है।",
    "es": "Elige el idioma de la interfaz. Este ajuste se guarda en este dispositivo. Parte del contenido permanece en su idioma original."
  },
  "Profile & account": {
    "hi": "प्रोफ़ाइल और खाता",
    "es": "Perfil y cuenta"
  },
  "AniList connected": {
    "hi": "AniList कनेक्ट है",
    "es": "AniList conectado"
  },
  "Sign out": {
    "hi": "साइन आउट",
    "es": "Cerrar sesión"
  },
  "Guest profile · Your local library is saved in this browser.": {
    "hi": "अतिथि प्रोफ़ाइल · आपकी स्थानीय लाइब्रेरी इस ब्राउज़र में सहेजी गई है।",
    "es": "Perfil de invitado · Tu biblioteca local se guarda en este navegador."
  },
  "Connect AniList": {
    "hi": "AniList कनेक्ट करें",
    "es": "Conectar AniList"
  },
  "My List / Your Library": {
    "hi": "मेरी सूची / आपकी लाइब्रेरी",
    "es": "Mi lista / Tu biblioteca"
  },
  "Content & streaming": {
    "hi": "सामग्री और स्ट्रीमिंग",
    "es": "Contenido y streaming"
  },
  "Online streaming only. Use an authorized browser-compatible source or an official streaming provider.": {
    "hi": "केवल ऑनलाइन स्ट्रीमिंग। अधिकृत ब्राउज़र-संगत स्रोत या आधिकारिक स्ट्रीमिंग सेवा का उपयोग करें।",
    "es": "Solo streaming en línea. Usa una fuente autorizada compatible con el navegador o un proveedor oficial."
  },
  "Manage extensions": {
    "hi": "एक्सटेंशन प्रबंधित करें",
    "es": "Gestionar extensiones"
  },
  "installed": {
    "hi": "इंस्टॉल किए गए",
    "es": "instaladas"
  },
  "Show manga in navigation": {
    "hi": "नेविगेशन में मांगा दिखाएँ",
    "es": "Mostrar manga en la navegación"
  },
  "Manga library & discovery": {
    "hi": "मांगा लाइब्रेरी और खोज",
    "es": "Biblioteca y descubrimiento de manga"
  },
  "Tracking & release schedule": {
    "hi": "ट्रैकिंग और रिलीज़ शेड्यूल",
    "es": "Seguimiento y calendario de estrenos"
  },
  "Release calendar · My List and all upcoming episodes": {
    "hi": "रिलीज़ कैलेंडर · मेरी सूची और आने वाले सभी एपिसोड",
    "es": "Calendario de estrenos · Mi lista y próximos episodios"
  },
  "Test AniList connection": {
    "hi": "AniList कनेक्शन जाँचें",
    "es": "Probar conexión con AniList"
  },
  "Support & updates": {
    "hi": "सहायता और अपडेट",
    "es": "Soporte y actualizaciones"
  },
  "Report an issue / feedback": {
    "hi": "समस्या बताएँ / प्रतिक्रिया दें",
    "es": "Informar de un problema / comentarios"
  },
  "Community issues": {
    "hi": "समुदाय की समस्याएँ",
    "es": "Incidencias de la comunidad"
  },
  "Check for updates": {
    "hi": "अपडेट जाँचें",
    "es": "Buscar actualizaciones"
  },
  "Web releases": {
    "hi": "वेब रिलीज़",
    "es": "Versiones web"
  },
  "Latest website changes": {
    "hi": "वेबसाइट के नवीनतम बदलाव",
    "es": "Últimos cambios del sitio"
  },
  "About AniDash Go": {
    "hi": "AniDash Go के बारे में",
    "es": "Acerca de AniDash Go"
  },
  "Anime & manga web companion · Version": {
    "hi": "एनीमे और मांगा वेब साथी · संस्करण",
    "es": "Compañero web de anime y manga · Versión"
  },
  "Developed by Anshdeep Singh": {
    "hi": "Anshdeep Singh द्वारा विकसित",
    "es": "Desarrollado por Anshdeep Singh"
  },
  "Developer GitHub": {
    "hi": "डेवलपर GitHub",
    "es": "GitHub del desarrollador"
  },
  "Developer website": {
    "hi": "डेवलपर वेबसाइट",
    "es": "Sitio del desarrollador"
  },
  "AniDash Android app": {
    "hi": "AniDash Android ऐप",
    "es": "Aplicación Android de AniDash"
  },
  "Open-source licenses and attribution": {
    "hi": "ओपन-सोर्स लाइसेंस और श्रेय",
    "es": "Licencias de código abierto y atribución"
  },
  "Trending Right Now": {
    "hi": "अभी लोकप्रिय",
    "es": "Tendencias del momento"
  },
  "Top of the Season": {
    "hi": "सीज़न के शीर्ष शो",
    "es": "Lo mejor de la temporada"
  },
  "Best of Last Season": {
    "hi": "पिछले सीज़न के बेहतरीन शो",
    "es": "Lo mejor de la temporada anterior"
  },
  "Coming Soon": {
    "hi": "जल्द आ रहा है",
    "es": "Próximamente"
  },
  "Trending Movies": {
    "hi": "लोकप्रिय फ़िल्में",
    "es": "Películas en tendencia"
  },
  "Trending Manga": {
    "hi": "लोकप्रिय मांगा",
    "es": "Manga en tendencia"
  },
  "Trending Manhwa": {
    "hi": "लोकप्रिय मनह्वा",
    "es": "Manhwa en tendencia"
  },
  "Trending Manhua": {
    "hi": "लोकप्रिय मनहुआ",
    "es": "Manhua en tendencia"
  },
  "Discover series": {
    "hi": "सीरीज़ खोजें",
    "es": "Descubrir series"
  },
  "Custom sources": {
    "hi": "कस्टम स्रोत",
    "es": "Fuentes personalizadas"
  },
  "Continue Watching": {
    "hi": "देखना जारी रखें",
    "es": "Seguir viendo"
  },
  "Loading watch progress…": {
    "hi": "देखने की प्रगति लोड हो रही है…",
    "es": "Cargando progreso…"
  },
  "Retry": {
    "hi": "फिर कोशिश करें",
    "es": "Reintentar"
  },
  "Refresh": {
    "hi": "रीफ़्रेश",
    "es": "Actualizar"
  },
  "Release schedule": {
    "hi": "रिलीज़ शेड्यूल",
    "es": "Calendario de estrenos"
  },
  "Upcoming anime episodes in your local time. Dates are provided by AniList and may change.": {
    "hi": "आपके स्थानीय समय में आगामी एनीमे एपिसोड। तारीखें AniList से आती हैं और बदल सकती हैं।",
    "es": "Próximos episodios en tu hora local. Las fechas provienen de AniList y pueden cambiar."
  },
  "All releases": {
    "hi": "सभी रिलीज़",
    "es": "Todos los estrenos"
  },
  "Previous week": {
    "hi": "पिछला हफ़्ता",
    "es": "Semana anterior"
  },
  "This week": {
    "hi": "इस हफ़्ते",
    "es": "Esta semana"
  },
  "Next week": {
    "hi": "अगला हफ़्ता",
    "es": "Próxima semana"
  },
  "Loading release dates…": {
    "hi": "रिलीज़ की तारीखें लोड हो रही हैं…",
    "es": "Cargando fechas de estreno…"
  },
  "Try again": {
    "hi": "फिर कोशिश करें",
    "es": "Intentar de nuevo"
  },
  "Episode": {
    "hi": "एपिसोड",
    "es": "Episodio"
  },
  "Loading player…": {
    "hi": "प्लेयर लोड हो रहा है…",
    "es": "Cargando reproductor…"
  },
  "Could not load this title.": {
    "hi": "यह शीर्षक लोड नहीं हो सका।",
    "es": "No se pudo cargar este título."
  },
  "This episode has not been released or does not exist.": {
    "hi": "यह एपिसोड रिलीज़ नहीं हुआ है या मौजूद नहीं है।",
    "es": "Este episodio no se ha estrenado o no existe."
  },
  "Back to details": {
    "hi": "विवरण पर वापस जाएँ",
    "es": "Volver a los detalles"
  },
  "Your home screen is empty": {
    "hi": "आपकी होम स्क्रीन खाली है",
    "es": "Tu pantalla de inicio está vacía"
  },
  "Missed Sequels": {
    "hi": "छूटे सीक्वल",
    "es": "Secuelas pendientes"
  },
  "Library": {
    "hi": "लाइब्रेरी",
    "es": "Biblioteca"
  },
  "Files": {
    "hi": "फ़ाइलें",
    "es": "Archivos"
  },
  "Entries": {
    "hi": "प्रविष्टियाँ",
    "es": "Entradas"
  },
  "TV Shows": {
    "hi": "टीवी शो",
    "es": "Series"
  },
  "Movies": {
    "hi": "फ़िल्में",
    "es": "Películas"
  },
  "Specials": {
    "hi": "विशेष",
    "es": "Especiales"
  },
  "Remove from Continue Watching": {
    "hi": "देखना जारी रखें से हटाएँ",
    "es": "Quitar de Seguir viendo"
  },
  "Removed from Continue Watching": {
    "hi": "देखना जारी रखें से हटाया गया",
    "es": "Eliminado de Seguir viendo"
  },
  "Recent Releases": {
    "hi": "हाल की रिलीज़",
    "es": "Estrenos recientes"
  },
  "No confirmed releases for this date.": {
    "hi": "इस तारीख के लिए कोई पुष्टि की गई रिलीज़ नहीं है।",
    "es": "No hay estrenos confirmados para esta fecha."
  },
  "No confirmed My List releases for this date.": {
    "hi": "इस तारीख के लिए मेरी सूची में कोई पुष्टि की गई रिलीज़ नहीं है।",
    "es": "No hay estrenos confirmados de Mi lista para esta fecha."
  },
  "Resume": {
    "hi": "जारी रखें",
    "es": "Continuar"
  },
  "Start episode": {
    "hi": "एपिसोड शुरू करें",
    "es": "Iniciar episodio"
  },
  "Could not sync your watch list.": {
    "hi": "आपकी वॉच लिस्ट सिंक नहीं हो सकी।",
    "es": "No se pudo sincronizar tu lista."
  },
  "No tagged web release is published. View the latest changes on GitHub.": {
    "hi": "कोई टैग की गई वेब रिलीज़ प्रकाशित नहीं है। GitHub पर नवीनतम बदलाव देखें।",
    "es": "No hay una versión web etiquetada. Consulta los últimos cambios en GitHub."
  },
  "Latest published web release: ": {
    "hi": "नवीनतम प्रकाशित वेब रिलीज़: ",
    "es": "Última versión web publicada: "
  },
  "AniList metadata request succeeded.": {
    "hi": "AniList मेटाडेटा अनुरोध सफल रहा।",
    "es": "La solicitud de metadatos de AniList fue correcta."
  }
}
export function normalizeLanguage(value:unknown):UiLanguage { return value==="hi"||value==="es"?value:"en" }
export function translate(language:UiLanguage, source:string):string { return language==="en"||!Object.prototype.hasOwnProperty.call(messages,source)?source:messages[source][language]||source }
