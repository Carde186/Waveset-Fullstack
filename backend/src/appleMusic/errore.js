class ErroreAppleMusic extends Error {
    constructor(codice, stato = 502) {
        super(codice);
        this.codice = codice;
        this.stato = stato;
    }
}
module.exports = { ErroreAppleMusic };
