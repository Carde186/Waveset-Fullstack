require('dotenv').config();

const creaApp = require('./app');

const porta = process.env.PORT || 3000;

function avviaServer() {
    const app = creaApp();

    app.listen(porta, () => {
        console.log(`Server in ascolto sulla porta ${porta}`);
    });
}

avviaServer();
